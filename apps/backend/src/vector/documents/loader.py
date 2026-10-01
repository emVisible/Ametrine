from glob import glob
from multiprocessing import Pool
from os import cpu_count, path
from typing import List

from langchain.docstore.document import Document
from langchain_community.document_loaders import (
    CSVLoader,
    TextLoader,
    UnstructuredEmailLoader,
    UnstructuredEPubLoader,
    UnstructuredExcelLoader,
    UnstructuredHTMLLoader,
    UnstructuredODTLoader,
    UnstructuredPDFLoader,
    UnstructuredPowerPointLoader,
    UnstructuredWordDocumentLoader,
)
from src.client import get_splitter
from src.config import doc_addr
from tqdm import tqdm

LOADER_MAPPING = {
    ".csv": (CSVLoader, {}),
    ".doc": (UnstructuredWordDocumentLoader, {}),
    ".docx": (UnstructuredWordDocumentLoader, {}),
    ".eml": (UnstructuredEmailLoader, {}),
    ".epub": (UnstructuredEPubLoader, {}),
    ".html": (UnstructuredHTMLLoader, {}),
    # Markdown 走 TextLoader，不走 UnstructuredMarkdownLoader。
    # 后者会把 md 转成 HTML 再交给 partition_html，而那条路会**在下载 spaCy 句子模型时**
    # 发起联网请求（实测：`Failed to download spaCy model from https://github.com/explosion/...`
    # → 在这台机器上直接 SSL EOF 失败）。Markdown 本来就是纯文本，切分由下面的 splitter 做，
    # 所以这里没有任何理由为了"解析"去联网下载模型 —— 自托管知识库的入库路径
    # 依赖一次外部下载，等于把可用性押在别人家的网络上。
    ".md": (TextLoader, {"encoding": "utf8"}),
    ".markdown": (TextLoader, {"encoding": "utf8"}),
    ".odt": (UnstructuredODTLoader, {}),
    ".pdf": (UnstructuredPDFLoader, {}),
    ".ppt": (UnstructuredPowerPointLoader, {}),
    ".pptx": (UnstructuredPowerPointLoader, {}),
    ".txt": (TextLoader, {"encoding": "utf8"}),
    # .xls 被移除了：unstructured 0.22.x 里 `unstructured.partition.xls` 这个模块根本不存在
    # （实测 ModuleNotFoundError），Langchain 的 UnstructuredExcelLoader 只是把请求往下传。
    # 留着它等于在界面上邀请用户上传一份永远解析不了的旧格式，而且会以 500 收场。
    # .xlsx 能解析（openpyxl + msoffcrypto-tool），所以旧表格的正确建议是"另存为 .xlsx 再传"。
    ".xlsx": (UnstructuredExcelLoader, {}),
}


class ParserUnavailable(Exception):
    """扩展名在白名单里，但这套部署缺了解析它的依赖。

    区别于「文件类型不接受」（415）和「上游模型服务不可用」（502）：这是部署能力缺口，
    用户没有做错任何事，重装依赖就能修 —— 所以必须给出**装什么**，而不是一个 500。

    不写自定义 __init__：批量入库走 multiprocessing.Pool，异常要能被 pickle 重建，
    而 `Exception(*args)` 的默认签名一旦改动就会在父进程里炸成 TypeError。
    """

    ext: str = ""
    hint: str = ""

    @classmethod
    def for_format(cls, ext: str, hint: str) -> "ParserUnavailable":
        exc = cls(f"{ext} 在当前部署中无法解析：{hint}")
        exc.ext = ext
        exc.hint = hint
        return exc


# 实测过的失败点 → 修复动作。命中不了就退回通用文案，绝不把原始堆栈写给调用方。
# 措辞里不要写死扩展名：同一个依赖会服务多个格式（pandoc 同时管 .epub 和 .odt，实测），
# 而调用方已经在前缀里带了用户上传的那个扩展名。
_FIX_HINTS = {
    "unstructured_inference.inference.pdf_image": (
        "需要 unstructured-inference>=1.6.10（当前锁在 1.1.1，缺 inference.pdf_image 模块）"
    ),
    "pi_heif": "需要 pi-heif>=1.2,<2",
    "pypandoc": "需要 pypandoc（含 pandoc 可执行文件；EPUB 与 ODT 都走它）",
    "libreoffice": "旧版 Office 格式需要 LibreOffice（soffice）先转成 OOXML",
    "soffice": "旧版 Office 格式需要 LibreOffice（soffice）先转成 OOXML",
}


def _fix_hint(exc: BaseException) -> str:
    haystack = f"{getattr(exc, 'name', '')} {exc}".lower()
    for needle, hint in _FIX_HINTS.items():
        if needle.lower() in haystack:
            return hint
    # 命中不了就不回传异常原文：里面可能有绝对路径、临时目录、依赖版本。
    # 完整堆栈进日志，调用方只拿到「这套部署缺依赖」这个事实。
    return "缺少对应的解析库或可执行文件（完整原因见服务端日志 ametrine.log）"


def load_document(file_path: str) -> List[Document]:
    ext = "." + file_path.rsplit(".", 1)[-1].lower()
    try:
        if ext in LOADER_MAPPING:
            loader_class, loader_args = LOADER_MAPPING[ext]
            loader = loader_class(file_path, **loader_args)
            return loader.load()
    except (ImportError, ModuleNotFoundError, OSError) as e:
        # ImportError 覆盖 unstructured 的「Following dependencies are missing: pypandoc」；
        # OSError 覆盖 subprocess 找不到 soffice/pandoc 可执行文件（FileNotFoundError 是其子类）。
        raise ParserUnavailable.for_format(ext, _fix_hint(e)) from e
    raise ValueError(f"不支持的文件类型 {ext or '(无扩展名)'}")



def load_documents(source_dir: str, ignored_files: List[str] = []) -> List[Document]:
    all_files = []
    for ext in LOADER_MAPPING:
        all_files.extend(glob(path.join(source_dir, f"**/*{ext}"), recursive=True))
    filtered_files = [
        file_path for file_path in all_files if file_path not in ignored_files
    ]

    with Pool(processes=cpu_count()) as pool:
        results = []
        with tqdm(total=len(filtered_files), desc="文档加载中", ncols=80) as pbar:
            for i, docs in enumerate(
                pool.imap_unordered(load_document, filtered_files)
            ):
                results.extend(docs)
                pbar.update()

    return results


def process_documents(
    is_multiple: bool, file_path: str, ignored_files: List[str] = []
) -> List[Document]:
    if is_multiple == True:
        documents = load_documents(doc_addr, ignored_files)
    else:
        documents = load_document(file_path=file_path)
    if not documents:
        # 原来是 exit(0)：这是个 SystemExit，在请求线程里会把 uvicorn 进程直接带走 ——
        # 上传一份解析不出内容的文件（扫描件、空 PDF）就足以打死整个后端。
        raise ValueError("文档解析结果为空，请确认文件是否有可提取的文本内容")
    splitter = get_splitter()
    texts = splitter.split_documents(documents)
    return texts
