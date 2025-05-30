from glob import glob
from multiprocessing import Pool
from os import cpu_count, path
from traceback import print_exc
from typing import List

from langchain.docstore.document import Document
from langchain_community.document_loaders import (
    CSVLoader,
    TextLoader,
    UnstructuredEmailLoader,
    UnstructuredEPubLoader,
    UnstructuredExcelLoader,
    UnstructuredHTMLLoader,
    UnstructuredMarkdownLoader,
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
    ".md": (UnstructuredMarkdownLoader, {}),
    ".odt": (UnstructuredODTLoader, {}),
    ".pdf": (UnstructuredPDFLoader, {}),
    ".ppt": (UnstructuredPowerPointLoader, {}),
    ".pptx": (UnstructuredPowerPointLoader, {}),
    ".txt": (TextLoader, {"encoding": "utf8"}),
    ".xls": (UnstructuredExcelLoader, {}),
    ".xlsx": (UnstructuredExcelLoader, {}),
}


def load_document(file_path: str) -> List[Document]:
    try:
        ext = "." + file_path.rsplit(".", 1)[-1]
        if ext in LOADER_MAPPING:
            loader_class, loader_args = LOADER_MAPPING[ext]
            loader = loader_class(file_path, **loader_args)
            return loader.load()
    except Exception as e:
        print_exc()
        raise e


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
        exit(0)
    splitter = get_splitter()
    texts = splitter.split_documents(documents)
    return texts
