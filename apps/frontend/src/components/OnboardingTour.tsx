// src/components/OnboardingTour.tsx
// 外壳复用 Modal（portal + 焦点移入 + Esc + 背景 inert + 入场动效），
// 之前它自己拼了一层 fixed 遮罩并写着 aria-modal="true"，
// 但焦点从没进过对话框、背景照旧可 Tab、Esc 关掉——新用户的第一个弹窗反而最不可达。
import { useState } from "react";
import { Link } from "react-router";
import { Modal } from "./ui";
import {
  ArrowLeftIcon,
  BookIcon,
  ChevronRightIcon,
  LibraryIcon,
  SearchIcon,
} from "./icons";

interface Step {
  title: string;
  description: string;
  Icon: typeof BookIcon;
  action?: { to: string; label: string };
}

const steps: Step[] = [
  {
    title: "创建知识库",
    description:
      "知识库是检索的边界。先创建一个数据库，并把它绑定到租户，后续文档只会在这个范围内被检索。",
    Icon: LibraryIcon,
    action: { to: "/admin/vector", label: "前往知识库管理" },
  },
  {
    title: "上传并索引文档",
    description:
      "上传 PDF、Word、Markdown 等文件，系统会解析、分块并写入向量索引，每个文档保留索引状态以便排查失败。",
    Icon: BookIcon,
  },
  {
    title: "开始检索问答",
    description:
      "在检索对话中选择知识库与集合，回答会附带引用来源与相关性，可回溯到具体分块。",
    Icon: SearchIcon,
    action: { to: "/rag", label: "前往检索对话" },
  },
];

export default function OnboardingTour({
  onHide,
  onFinish,
}: {
  onHide: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  if (!current) return null;

  const last = step === steps.length - 1;

  return (
    <Modal
      open
      onClose={onHide}
      title={`快速上手 · ${current.title}`}
      description={`第 ${step + 1} / ${steps.length} 步`}
      footer={
        <>
          <button
            type="button"
            onClick={onFinish}
            className="a-btn a-btn-ghost !py-1 text-[11px]"
          >
            跳过引导
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="a-btn a-btn-outline !py-1"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              上一步
            </button>
          )}
          {/* 这两行必须留在 JSX 注释里：写成 // 会被当作子节点渲染到卡片上 */}
          <button
            type="button"
            onClick={() => (last ? onFinish() : setStep(step + 1))}
            className="a-btn a-btn-primary !py-1"
          >
            {last ? "开始使用" : "下一步"}
            {!last && <ChevronRightIcon className="h-3.5 w-3.5" />}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[--radius-md] border border-accent-border bg-accent-soft text-accent-ink">
          <current.Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[--text-sm] leading-relaxed text-ink-muted">
            {current.description}
          </p>
          {current.action && (
            // 「去哪儿」属于这一步的内容，不是按钮行的第二个主操作
            <Link
              to={current.action.to}
              onClick={onFinish}
              className="mt-2 inline-flex items-center gap-1 text-[--text-sm] text-accent-ink hover:underline"
            >
              {current.action.label}
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <span
            key={s.title}
            className={`h-1 flex-1 rounded-full ${
              i <= step ? "bg-accent" : "bg-line-strong"
            }`}
          />
        ))}
      </div>
    </Modal>
  );
}
