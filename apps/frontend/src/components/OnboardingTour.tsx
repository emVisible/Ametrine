// src/components/OnboardingTour.tsx
// 外壳复用 Modal（portal + 焦点移入 + Esc + 背景 inert + 入场动效），
// 之前它自己拼了一层 fixed 遮罩并写着 aria-modal="true"，
// 但焦点从没进过对话框、背景照旧可 Tab、Esc 关掉——新用户的第一个弹窗反而最不可达。
import { useState } from "react";
import { Link } from "react-router";
import { Modal } from "./ui";
import { useI18n } from "../i18n/context";
import {
  ArrowLeftIcon,
  BookIcon,
  ChevronRightIcon,
  LibraryIcon,
  SearchIcon,
} from "./icons";

/**
 * 步骤表只存文案键：模块级常量存译文的话，切语言后仍然是旧语言。
 */
interface Step {
  titleKey: string;
  descKey: string;
  Icon: typeof BookIcon;
  action?: { to: string; labelKey: string };
}

const steps: Step[] = [
  {
    titleKey: "tour.createDb.title",
    descKey: "tour.createDb.desc",
    Icon: LibraryIcon,
    action: { to: "/admin/vector", labelKey: "tour.createDb.action" },
  },
  {
    titleKey: "tour.uploadDocs.title",
    descKey: "tour.uploadDocs.desc",
    Icon: BookIcon,
  },
  {
    titleKey: "tour.startRag.title",
    descKey: "tour.startRag.desc",
    Icon: SearchIcon,
    action: { to: "/rag", labelKey: "tour.startRag.action" },
  },
];

export default function OnboardingTour({
  onHide,
  onFinish,
}: {
  onHide: () => void;
  onFinish: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const current = steps[step];
  if (!current) return null;

  const last = step === steps.length - 1;

  return (
    <Modal
      open
      onClose={onHide}
      title={t("tour.modalTitle", { title: t(current.titleKey) })}
      description={t("tour.stepOf", { current: step + 1, total: steps.length })}
      footer={
        <>
          <button
            type="button"
            onClick={onFinish}
            className="a-btn a-btn-ghost !py-1 text-[11px]"
          >
            {t("tour.skip")}
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="a-btn a-btn-outline !py-1"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              {t("tour.prev")}
            </button>
          )}
          {/* 这两行必须留在 JSX 注释里：写成 // 会被当作子节点渲染到卡片上 */}
          <button
            type="button"
            onClick={() => (last ? onFinish() : setStep(step + 1))}
            className="a-btn a-btn-primary !py-1"
          >
            {last ? t("tour.finish") : t("tour.next")}
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
            {t(current.descKey)}
          </p>
          {current.action && (
            // 「去哪儿」属于这一步的内容，不是按钮行的第二个主操作
            <Link
              to={current.action.to}
              onClick={onFinish}
              className="mt-2 inline-flex items-center gap-1 text-[--text-sm] text-accent-ink hover:underline"
            >
              {t(current.action.labelKey)}
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <span
            key={s.titleKey}
            className={`h-1 flex-1 rounded-full ${
              i <= step ? "bg-accent" : "bg-line-strong"
            }`}
          />
        ))}
      </div>
    </Modal>
  );
}
