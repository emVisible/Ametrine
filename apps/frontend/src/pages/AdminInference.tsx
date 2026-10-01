// src/pages/AdminInference.tsx
// 模型推理管理台。
//
// 这页存在的理由：以前「系统用哪个模型」只活在 `.env` 里 —— 改一次要重启，加载要跑 shell 脚本，
// 而加载失败在界面上完全看不见，用户看到的是「服务都是绿的，就是答不上来」。
// 所以这页每条读数都来自服务器现算（`/api/inference/overview`），我们一个数字都不存。
//
// 三条界面纪律（都是这一晚在别处踩出来的，见交接文档 §11）：
//  1) 不摆「点了没反应」的控件：能看见的按钮就等于能用；禁用时必须把原因写进 title。
//  2) 不显示编出来的数：进度拿不到就写「未知」，显存除不开就画「—」，不画 0%。
//  3) 页面文件只导出组件（纯函数在 utils/inferenceFormat.ts），否则整个模块失去 fast refresh。
import { useMemo, useState, type ReactNode } from "react";
import type {
  CachedWeight,
  EngineSpec,
  InferenceOverview,
  InferenceRole,
  LaunchBody,
  RegisteredModel,
  RunningModel,
} from "../api/inference";
import {
  CheckIcon,
  DatabaseIcon,
  DownloadIcon,
  LayersIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
} from "../components/icons";
import {
  Breadcrumbs,
  DataTable,
  Disclosure,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  Toggle,
  type Column,
} from "../components/ui";
import { Spinner } from "../components/icons";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  useBindModel,
  useInferenceCatalog,
  useInferenceLiveness,
  useInferenceOverview,
  useInferenceRegistrations,
  useInferenceRelogin,
  useLaunchModel,
  useLaunchProgress,
  useSetAutostart,
  useTerminateModel,
} from "../hooks/queries";
import { useI18n } from "../i18n/context";
import type { MsgKey } from "../i18n";
import { useConfirm } from "../hooks/useConfirm";
import {
  describeChoice,
  filterRegistrations,
  instanceLabel,
  isRunning,
  lenRisk,
  modelsForRole,
  openLaunches,
  parseExtra,
  percentOf,
  probeCounts,
  probeToneOf,
  quantOf,
  ratioPercent,
  runningIndex,
  sortRegistrations,
  uidOf,
  uidProblem,
  versionForSpec,
  type LaunchChoice,
} from "../utils/inferenceFormat";

const ROLES: InferenceRole[] = ["llm", "embedding", "rerank"];
/** 存文案键而不是文案：切语言时这张表不需要重建（且写错的键在 tsc 阶段就红）。 */
const ROLE_LABEL_KEY: Record<InferenceRole, MsgKey> = {
  llm: "admin.inference.roleLlm",
  embedding: "admin.inference.roleEmbedding",
  rerank: "admin.inference.roleRerank",
};

const CATALOG_TYPES = ["LLM", "embedding", "rerank", "image"] as const;
type CatalogType = (typeof CATALOG_TYPES)[number];
const TYPE_LABEL_KEY: Record<CatalogType, MsgKey> = {
  LLM: "admin.inference.typeLlm",
  embedding: "admin.inference.typeEmbedding",
  rerank: "admin.inference.typeRerank",
  image: "admin.inference.typeImage",
};

// 空值必须是**同一个引用**：`data?.x ?? []` 每次渲染都造新数组，
// 于是把它们放进 useMemo 依赖等于没有 memo。
const NO_MODELS: RunningModel[] = [];
const NO_LAUNCH_ERRORS: InferenceOverview["launch_errors"] = {};

/** 顶部状态格：一格一个事实，不做卡片套卡片。 */
function StatCell({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  hint?: string;
}) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3">
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[--text-sm] font-medium text-ink">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            tone === "success"
              ? "bg-success"
              : tone === "warning"
                ? "bg-warning"
                : tone === "danger"
                  ? "bg-danger"
                  : "bg-line-strong"
          }`}
          aria-hidden
        />
        <span className="truncate" title={value}>
          {value}
        </span>
      </p>
      {hint && (
        <p className="mt-0.5 truncate text-[11px] text-ink-subtle" title={hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** 显存条。百分比算不出来时宁可空着 —— 画个 0% 是假话。 */
function MemBar({ used, total }: { used?: number; total?: number }) {
  const { t } = useI18n();
  const pct = ratioPercent(used, total);
  return (
    <div className="w-full min-w-[7rem]">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct == null ? undefined : Math.round(pct)}
        aria-label={t("admin.inference.vram")}
      >
        {pct != null && (
          <span
            className={`block h-full rounded-full ${
              pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-accent"
            }`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink-subtle tnum">
        {pct == null
          ? t("common.unknown")
          : `${gib(used)} / ${gib(total)} · ${Math.round(pct)}%`}
      </p>
    </div>
  );
}

function gib(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const v = bytes / 1024 ** 3;
  return v > 0 && v < 0.1 ? `${Math.round(bytes / 1024 ** 2)} MiB` : `${v.toFixed(v >= 10 ? 0 : 1)} GiB`;
}

/** 一行角色的绑定状态 + 「换模型」。 */
function BindingRow({
  role,
  models,
  currentUid,
  fromSettings,
  onPick,
}: {
  role: InferenceRole;
  models: RunningModel[];
  currentUid: string;
  fromSettings: boolean;
  onPick: (uid: string, name: string) => void;
}) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const candidates = modelsForRole(models, role);
  const current = models.find((m) => uidOf(m) === currentUid);
  const name = current?.model_name || currentUid;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[--text-sm] font-medium text-ink">
            {t(ROLE_LABEL_KEY[role])}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-subtle">
            {currentUid ? (
              <>
                <span className="truncate text-ink-muted" title={currentUid}>
                  {name}
                </span>
                {!current && (
                  <StatusBadge tone="warning" title={t("admin.inference.notLoadedHint")}>
                    {t("admin.inference.notLoaded")}
                  </StatusBadge>
                )}
                {fromSettings && (
                  <StatusBadge tone="neutral" title={t("admin.inference.fromSettingsHint")}>
                    {t("admin.inference.fromSettings")}
                  </StatusBadge>
                )}
              </>
            ) : (
              <span>{t("admin.inference.notBound")}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="a-btn a-btn-outline !py-1"
          onClick={() => setPicking(true)}
        >
          {t("admin.inference.change")}
        </button>
      </div>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title={t("admin.inference.pickTitle", { role: t(ROLE_LABEL_KEY[role]) })}
        description={t("admin.inference.pickDesc")}
      >
        {candidates.length ? (
          <ul className="flex flex-col gap-1.5">
            {candidates.map((m) => {
              const uid = uidOf(m);
              const selected = uid === currentUid;
              return (
                <li key={uid}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      onPick(uid, m.model_name || uid);
                      setPicking(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-[--radius-sm] border px-3 py-2 text-left transition-ui ${
                      selected
                        ? "border-accent-border bg-accent-soft text-ink"
                        : "border-line bg-surface hover:bg-surface-hover"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[--text-sm]" title={uid}>
                        {m.model_name || uid}
                      </span>
                      <span className="block truncate text-[11px] text-ink-subtle">
                        {uid}
                        {m.model_engine ? ` · ${m.model_engine}` : ""}
                      </span>
                    </span>
                    {selected && (
                      <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={LayersIcon}
            title={t("admin.inference.noCandidate")}
            description={t("admin.inference.noCandidateDesc")}
          />
        )}
      </Modal>
    </>
  );
}

/** 一条在途加载：进度未知就说未知，不画假百分比；进度端点自己坏了也要说出来。 */
function PendingRow({
  uid,
  models,
  error,
  onDismiss,
}: {
  uid: string;
  models: RunningModel[];
  error?: string;
  /** 收起这一行。没有它，一条永远不会成功的加载会一直转 + 一直轮 */
  onDismiss: (uid: string) => void;
}) {
  const { t } = useI18n();
  const running = isRunning(models, uid);
  const progress = useLaunchProgress(uid, !running && !error);
  const pct = percentOf(progress.data);

  return (
    <li className="flex flex-wrap items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-[--text-sm] text-ink" title={uid}>
        {uid}
      </span>
      {error ? (
        <StatusBadge tone="danger" title={error}>
          {t("admin.inference.loadFailed")}
        </StatusBadge>
      ) : running ? (
        <StatusBadge tone="success" dot>
          {t("admin.inference.running")}
        </StatusBadge>
      ) : progress.isError ? (
        // 「读不到进度」和「进度未知」是两件事：前者是进度端点自己失败了（凭据、服务器
        // 重启、uid 被别的窗口卸载），后者是刚提交。混成一条会把人稳住在一个其实坏了的状态上。
        <StatusBadge
          tone="warning"
          title={progress.error instanceof Error ? progress.error.message : undefined}
        >
          {t("admin.inference.progressUnreachable")}
        </StatusBadge>
      ) : (
        <span className="flex items-center gap-2 text-[11px] text-ink-subtle">
          <Spinner className="h-3 w-3" aria-hidden />
          {pct == null ? t("common.unknown") : `${pct}%`}
          {progress.data?.stage ? ` · ${progress.data.stage}` : ""}
        </span>
      )}
      <button
        type="button"
        className="a-btn a-btn-ghost !px-2 !py-0.5 text-[11px]"
        onClick={() => onDismiss(uid)}
        title={t("admin.inference.dismissHint")}
      >
        {t("admin.inference.dismiss")}
      </button>
    </li>
  );
}

const NO_ENGINES: Record<string, EngineSpec[]> = {};

const NO_ROWS: RegisteredModel[] = [];

/**
 * 加载栏的分段标题。
 *
 * 这一栏曾经什么都平铺在同一个 gap 流里：事实、下拉、输入框、警告、按钮全是 11px 的
 * 同一种灰，于是「哪个控件属于哪件事」只能靠人自己猜。分段编号是因为顺序真的有讲究
 * （先定规格，再谈可选参数，最后提交），而猜错的人会去改 UID。
 */
function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tnum shrink-0 text-[11px] font-medium text-accent-ink">{n}</span>
      <h4 className="shrink-0 text-[11px] font-medium text-ink-muted">{title}</h4>
      <span className="h-px min-w-0 flex-1 bg-line-subtle" aria-hidden />
    </div>
  );
}

/** 一条服务器声明的事实：没声明的字段就是没有这一行，不补「—」也不补 0。 */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 text-[11px] text-ink-subtle">{label}</dt>
      <dd className="tnum min-w-0 truncate text-[--text-sm] text-ink" title={String(value)}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 目录里加载一个新模型：清单、引擎、大小、量化全部来自服务器，不写死在 .env。
 *
 * 三层职责（设计文档 §10）：
 *  T1 快捷路径 —— 挑型号 → 挑引擎/规格 → 加载，其余用服务器的默认值；
 *  T2 只暴露**我们自己也依赖**的参数（uid / 副本 / 上下文长度 / GPU 数量）；
 *  T3 其余引擎参数走 JSON 透传，不做表单 —— 实测引擎 API 不声明可设参数，
 *     照抄 xinference 的表单等于手工镜像一份会过期的知识。
 */
function CatalogLoader({
  onLaunched,
  onBind,
  cachedNames,
  runningUids,
  runningModelNames,
  appMaxLen,
  progress,
}: {
  onLaunched: (uid: string) => void;
  /** 选中的型号已经在跑时，真正该做的下一步是「让系统用它」，不是再启动一次 */
  onBind: (role: InferenceRole, uid: string, name: string) => void;
  /** 权重已在推理服务器盘上的型号名 —— 决定「点它能不能立刻起来」 */
  cachedNames: ReadonlySet<string>;
  /** 在跑的**实例 uid**：判「这个 uid 还要不要再启动一次」 */
  runningUids: ReadonlySet<string>;
  /** 在跑的**型号名**：清单行上那枚「运行中」徽章用它。与 uid 不是一回事，见 runningIndex */
  runningModelNames: ReadonlySet<string>;
  /** .env 的 MAX_MODEL_LEN：运行时发给引擎的 max_tokens，也是 prompt 截断预算 */
  appMaxLen?: number | null;
  /** 本次会话提交出去的加载。放在**这张卡里**而不是页面顶部：它的原因就是这里的按钮 */
  progress?: ReactNode;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<CatalogType>("embedding");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const registrations = useInferenceRegistrations(type);
  const catalog = useInferenceCatalog(type, picked);
  const launch = useLaunchModel();
  const [engine, setEngine] = useState("");
  const [specIndex, setSpecIndex] = useState(0);
  const [autostart, setAutostart] = useState(false);
  // T2
  const [uid, setUid] = useState("");
  const [replica, setReplica] = useState(1);
  const [maxLen, setMaxLen] = useState("");
  const [nGpu, setNGpu] = useState("auto");
  // T3
  const [extraText, setExtraText] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  const rows = registrations.data?.models ?? NO_ROWS;
  const listed = useMemo(
    () => sortRegistrations(filterRegistrations(rows, query), cachedNames),
    [rows, query, cachedNames],
  );
  const onDisk = useMemo(
    () => rows.filter((r) => cachedNames.has(r.model_name)).length,
    [rows, cachedNames],
  );

  const engines = catalog.data?.engines ?? NO_ENGINES;
  const engineNames = Object.keys(engines);
  const versions = catalog.data?.versions ?? [];

  // 换类型/换型号后原来的引擎可能压根不存在了，规格索引也可能越过界。
  // 这两件事都**在渲染期派生**而不是存成 state 再用 effect 纠偏：
  // 目录是唯一真相，派生永远与它一致；effect 纠偏会多级联一轮渲染，
  // 且纠偏前那一帧拿的是旧引擎去查新目录，正好能显示出「不属于这个引擎的参数」。
  const activeEngine = engineNames.includes(engine) ? engine : (engineNames[0] ?? "");
  const specs = engines[activeEngine] ?? [];
  const activeSpecIndex = specs.length ? Math.min(specIndex, specs.length - 1) : 0;

  const spec = specs[activeSpecIndex];
  const quant = quantOf(spec);
  const choice: LaunchChoice | null = spec
    ? {
        model_name: picked,
        model_type: type,
        engine: activeEngine,
        size_in_billions: spec.model_size_in_billions ?? undefined,
        model_format: spec.model_format,
        quantization: quant,
      }
    : null;
  const version = versionForSpec(versions, spec);

  const effectiveUid = uid.trim() || picked;
  // 已经在跑的**实例**（按 uid 判）：这时再启动一次没有意义，下一步是「让系统用它」。
  // 注意这里判的是 uid 而不是型号名 —— 名字相同的两个实例是两件事（见 runningIndex）。
  const alreadyRunning = !!picked && runningUids.has(effectiveUid);
  const bindRole: InferenceRole | null =
    type === "LLM" ? "llm" : type === "embedding" ? "embedding" : type === "rerank" ? "rerank" : null;

  const wantLen = maxLen.trim() ? Number(maxLen) : undefined;
  const wantLenBad = wantLen !== undefined && !Number.isFinite(wantLen);
  const risk = lenRisk(appMaxLen, wantLen, version?.max_tokens ?? undefined);
  const uidBad = uidProblem(uid);
  const extra = parseExtra(extraText);
  // 每个字段自己的理由只写一次，按钮的 title 和输入框下面的红字用的是同一句话。
  const uidErr =
    uidBad === "tooLong"
      ? t("admin.inference.uidTooLong")
      : uidBad === "reservedSuffix"
        ? t("admin.inference.uidReserved")
        : undefined;
  // 禁用的理由必须说得出名字（界面纪律 1）：每件事分开讲，因为它们是不同的改法。
  const blockReason =
    uidErr ??
    (extra.ok === false
      ? extra.code === "invalidJson"
        ? t("admin.inference.extraInvalidJson")
        : t("admin.inference.extraNotObject")
      : wantLenBad
        ? t("admin.inference.notANumber")
        : !choice
          ? t("admin.inference.noSpecForEngine")
          : undefined);
  // 提交前就能判定的几件事，任何一件不成立都不给按：
  // 「按了之后服务器回一句看不懂的话」比「按不动 + 说清为什么」坏得多。
  const blocked = !choice || uidBad !== null || extra.ok === false || wantLenBad;
  const body: LaunchBody | null =
    choice && extra.ok && !uidBad
      ? {
          model_name: choice.model_name,
          model_type: choice.model_type,
          model_uid: effectiveUid,
          model_engine: choice.engine,
          size_in_billions: choice.size_in_billions,
          model_format: choice.model_format,
          quantization: choice.quantization,
          replica,
          n_gpu: nGpu.trim() || undefined,
          ...(wantLen != null ? { max_model_len: wantLen } : {}),
          ...(extra.value ? { extra: extra.value } : {}),
          autostart,
        }
      : null;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          className="w-36"
          label={t("admin.inference.colType")}
          value={type}
          options={CATALOG_TYPES.map((v) => ({ value: v, label: t(TYPE_LABEL_KEY[v]) }))}
          onChange={(v) => {
            setType(v as CatalogType);
            setQuery("");
            setPicked("");
            setEngine("");
            setSpecIndex(0);
            setUid("");
            setMaxLen("");
            setExtraText("");
          }}
        />
        <SearchInput
          className="min-w-[12rem] flex-1"
          value={query}
          onValueChange={setQuery}
          placeholder={t("admin.inference.filterPlaceholder")}
        />
      </div>
      <p className="text-[11px] text-ink-subtle">{t("admin.inference.pickFlow")}</p>

      <div className="grid gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* 左：可浏览的型号清单。以前这里只有一个搜索框，
            而空态写的是「在下方目录里选一个加载」—— 没有清单可选，那句话是假话。 */}
        <div className="min-w-0">
          <p className="mb-1.5 flex items-center gap-2 text-[11px] text-ink-subtle">
            <span className="tnum">
              {registrations.isFetching
                ? t("common.loading")
                : t("admin.inference.modelCount", { n: rows.length, cached: onDisk })}
            </span>
            {registrations.isFetching && <Spinner className="h-3 w-3" aria-hidden />}
          </p>
          {registrations.isError ? (
            <div className="rounded-[--radius-md] border border-line px-3 py-4 text-[11px] text-danger">
              {registrations.error instanceof Error
                ? registrations.error.message
                : t("admin.inference.listFailed")}
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto rounded-[--radius-md] border border-line">
              {listed.length === 0 && (
                <li className="px-3 py-6 text-center text-[11px] text-ink-subtle">
                  {t("admin.inference.noMatch", { q: query.trim() })}
                </li>
              )}
              {listed.map((row) => {
                // 徽章判的是「这个型号有没有在跑」，所以拿型号名比 —— 别用 uid 那份集合，
                // 那样自定义过实例名的机器上这一行永远不显示运行中（见 runningIndex）。
                const running = runningModelNames.has(row.model_name);
                const selected = picked === row.model_name;
                return (
                  // 内置目录与用户注册的同名型号会同时出现，所以键不能只用名字。
                  <li
                    key={`${row.model_name}#${row.is_builtin === false ? "user" : "builtin"}`}
                    className="border-b border-line-subtle last:border-b-0"
                  >
                    {/* 在跑的那一行**照样可选**：选它的人十有八九是想「让系统用它」，
                        而不是再看一次它启动不了。选中后右栏给的是「去绑定」，不是禁用的加载。 */}
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => {
                        // 只清**跟着型号走**的东西：引擎与规格是服务器为这个型号声明的，
                        // uid 是实例身份（留着会把上一个实例的名字安到新模型上）。
                        // 副本数/上下文长度/透传 JSON 是人手打的本轮意图，原来一并被抹掉 ——
                        // 「点一行就吃掉我刚输入的东西」是破坏性操作，不是刷新。
                        setPicked(row.model_name);
                        setEngine("");
                        setSpecIndex(0);
                        setUid("");
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[--text-sm] transition-ui ${
                        selected
                          ? "bg-accent-soft text-ink"
                          : "text-ink-muted hover:bg-surface-hover hover:text-ink"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate" title={row.model_name}>
                        {row.model_name}
                      </span>
                      {running ? (
                        <StatusBadge tone="accent">{t("admin.inference.running")}</StatusBadge>
                      ) : cachedNames.has(row.model_name) ? (
                        <span className="shrink-0 text-[11px] text-ink-subtle">
                          {t("admin.inference.onDisk")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 右：选中之后才谈引擎与规格 */}
        <div className="flex min-w-0 flex-col gap-3">
          {!picked && (
            <p className="text-[11px] text-ink-subtle">{t("admin.inference.pickFromList")}</p>
          )}
          {picked && catalog.isFetching && (
            <p className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
              <Spinner className="h-3 w-3" aria-hidden />
              {t("common.loading")}
            </p>
          )}
          {picked &&
            !catalog.isFetching &&
            !catalog.isError &&
            !engineNames.length && (
              // 两条不同的事实，服务器其实都给了：`versions` 非空说明型号存在、只是本机跑不起来；
              // 两者都空才可能是「目录里没这个型号」。合成一句就会对第一种人说假话，
              // 让人去改型号名，而真正缺的是引擎（实测 kolors：versions=1、engines=0）。
              <p className="text-[11px] text-ink-subtle">
                {versions.length
                  ? t("admin.inference.noEngines", { name: picked, n: versions.length })
                  : t("admin.inference.noResult", { name: picked })}
              </p>
            )}
          {picked && catalog.isError && (
            <p className="flex items-start gap-1.5 text-[11px] text-danger">
              <WarningIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {catalog.error instanceof Error
                ? catalog.error.message
                : t("admin.inference.searchFailed")}
            </p>
          )}

          {picked && engineNames.length > 0 && (
            <div className="flex min-w-0 flex-col gap-4">
              {/* 摘要头：这一栏在讲哪个型号，以及服务器替它声明了什么。 */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    className="min-w-0 truncate text-[--text-base] font-medium text-ink"
                    title={picked}
                  >
                    {picked}
                  </h3>
                  {alreadyRunning && (
                    <StatusBadge tone="accent">{t("admin.inference.running")}</StatusBadge>
                  )}
                  {version && (
                    <StatusBadge tone={version.cache_status ? "success" : "warning"}>
                      {version.cache_status
                        ? t("admin.inference.cached")
                        : t("admin.inference.notCached")}
                    </StatusBadge>
                  )}
                </div>

                {/* 事实摆在控件**之上**，因为换引擎或换规格时它会跟着变 —— 人得先看见它变，
                    才敢按下面的提交。每条只占一行 label/value：没声明的字段就没有这一行，
                    不补「—」（实测 LLM 的版本条目根本没有 dimensions，对话模型不该看到
                    「向量维度: —」这种像坏了的读数）。 */}
                <dl className="mt-2 grid gap-x-6 gap-y-1 rounded-[--radius-md] bg-surface-sunken px-3 py-2 sm:grid-cols-2">
                  {spec?.model_size_in_billions != null && (
                    <Fact
                      label={t("admin.inference.factSize")}
                      value={`${spec.model_size_in_billions}B`}
                    />
                  )}
                  {spec?.model_format && (
                    <Fact label={t("admin.inference.factFormat")} value={spec.model_format} />
                  )}
                  {quant && quant !== "none" && (
                    <Fact label={t("admin.inference.factQuant")} value={quant} />
                  )}
                  {type === "embedding" && version?.dimensions != null && (
                    <Fact
                      label={t("admin.inference.dimensions")}
                      value={version.dimensions}
                    />
                  )}
                  {version?.max_tokens ? (
                    <Fact
                      label={t("admin.inference.contextCap")}
                      value={version.max_tokens}
                    />
                  ) : null}
                </dl>
                {version && !version.cache_status && (
                  <p className="mt-1.5 text-[11px] text-ink-subtle">
                    {t("admin.inference.downloadHint")}
                  </p>
                )}
              </div>

              <section className="flex min-w-0 flex-col gap-2.5">
                <StepHead n={1} title={t("admin.inference.stepEngine")} />
                <div className="flex flex-wrap items-end gap-3">
                  <Select
                    className="w-44"
                    label={t("admin.inference.engine")}
                    value={activeEngine}
                    options={engineNames.map((e) => ({
                      value: e,
                      label: t("admin.inference.engineOption", {
                        name: e,
                        n: (engines[e] ?? []).length,
                      }),
                    }))}
                    onChange={(v) => {
                      setEngine(String(v));
                      setSpecIndex(0);
                    }}
                  />
                  <Select
                    className="w-52"
                    label={t("admin.inference.spec")}
                    value={String(activeSpecIndex)}
                    options={specs.map((s, i) => ({
                      value: String(i),
                      label:
                        describeChoice({
                          model_name: s.model_name ?? picked,
                          model_type: type,
                          size_in_billions: s.model_size_in_billions ?? undefined,
                          model_format: s.model_format,
                          quantization: quantOf(s),
                        }) || t("common.unknown"),
                    }))}
                    onChange={(v) => setSpecIndex(Number(v))}
                  />
                </div>
              </section>

              {/* T2：只放 Ametrine 自己会读的那几个（设计文档 §10.3 的判据）。
                  输入一律走 TextInput：同一页里自制下拉 + 原生输入框会长成两个世界，
                  而原生 `<input>` 的错误提示只能靠自己拼，拼错一次就没人看得见理由。 */}
              <section className="flex min-w-0 flex-col gap-2.5">
                <StepHead n={2} title={t("admin.inference.stepParams")} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <TextInput
                    label={t("admin.inference.fieldUid")}
                    optional={t("auth.optionalField")}
                    value={uid}
                    placeholder={picked}
                    onChange={(e) => setUid(e.target.value)}
                    error={uidErr}
                    hint={t("admin.inference.uidHint", { uid: effectiveUid })}
                  />
                  <TextInput
                    label={t("admin.inference.fieldReplica")}
                    type="number"
                    min={1}
                    step={1}
                    value={replica}
                    onChange={(e) => setReplica(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <TextInput
                    label={t("admin.inference.fieldMaxLen")}
                    optional={t("auth.optionalField")}
                    type="number"
                    min={1}
                    placeholder={t("admin.inference.fieldDefault")}
                    value={maxLen}
                    onChange={(e) => setMaxLen(e.target.value)}
                    hint={!risk && appMaxLen ? t("admin.inference.appAssumes", { n: String(appMaxLen) }) : undefined}
                  />
                  <TextInput
                    label={t("admin.inference.fieldNGpu")}
                    optional={t("auth.optionalField")}
                    value={nGpu}
                    placeholder="auto"
                    onChange={(e) => setNGpu(e.target.value)}
                  />
                </div>

                {/* 上下文长度的一致性：这是 Ametrine 的加载页相对 xinference 的实际增量 ——
                    只有我们知道运行时那个值（它同时是 max_tokens 与 prompt 预算），
                    而 xinference 的表单看不见 .env。只警告、不拦：我们说不出「你为什么故意开小」。 */}
                {risk && (
                  <p className="flex items-start gap-1.5 rounded-[--radius-md] border border-warning-border bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning">
                    <WarningIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>
                      {risk === "tooSmall"
                        ? t("admin.inference.riskTooSmall", {
                            want: String(wantLen ?? 0),
                            app: String(appMaxLen ?? 0),
                          })
                        : t("admin.inference.riskOverCap", {
                            want: String(wantLen ?? 0),
                            cap: String(version?.max_tokens ?? 0),
                          })}
                    </span>
                  </p>
                )}

                {/* T3：其余引擎参数透传，不做表单。收起的时候也必须看得见「里面是坏的」——
                    非法 JSON 会禁用提交按钮，而「点不动的按钮 + 收着的解释」是最坏的组合，
                    所以红徽章挂在头行上，而不是只存在于展开后的正文里。 */}
                <Disclosure
                  level={1}
                  open={moreOpen}
                  onToggle={() => setMoreOpen((v) => !v)}
                  title={t("admin.inference.moreConfig")}
                  meta={
                    extra.ok ? null : (
                      <StatusBadge tone="danger">{t("admin.inference.extraBad")}</StatusBadge>
                    )
                  }
                >
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-ink-subtle">
                      {t("admin.inference.moreConfigHint")}
                    </p>
                    <TextArea
                      className="min-h-20 font-mono text-[11px]"
                      value={extraText}
                      placeholder='{"max_num_seqs": 32, "download_dir": "/mnt/models"}'
                      onChange={(e) => setExtraText(e.target.value)}
                      aria-label={t("admin.inference.moreConfig")}
                      error={
                        extra.ok
                          ? undefined
                          : extra.code === "invalidJson"
                            ? t("admin.inference.extraInvalidJson")
                            : t("admin.inference.extraNotObject")
                      }
                    />
                  </div>
                </Disclosure>
              </section>

              {/* ③ 提交。加载与「把它绑为某角色」是同一格的两种下一步：已经在跑的型号，
                  再启动一次不是任何人想要的结果，禁用的加载按钮也不回答问题。 */}
              <section className="flex min-w-0 flex-col gap-2.5">
                <StepHead n={3} title={t("admin.inference.stepConfirm")} />
                <div className="flex flex-wrap items-center gap-3">
                  {alreadyRunning && bindRole ? (
                    <button
                      type="button"
                      className="a-btn a-btn-primary"
                      // 绑的是**在跑的那个实例**，所以传 uid；原来传的是型号名，
                      // 自定义过实例名时会写出一条指向不存在的 uid 的绑定。
                      onClick={() => onBind(bindRole, effectiveUid, picked)}
                    >
                      <CheckIcon className="h-3.5 w-3.5" aria-hidden />
                      {t("admin.inference.bindIt", { role: t(ROLE_LABEL_KEY[bindRole]) })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="a-btn a-btn-primary"
                      disabled={blocked || launch.isPending}
                      title={blockReason}
                      onClick={() => {
                        if (!body) return;
                        launch.mutate(body, {
                          onSuccess: () => onLaunched(body.model_uid || body.model_name),
                        });
                      }}
                    >
                      {launch.isPending ? (
                        <Spinner className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <DownloadIcon className="h-3.5 w-3.5" aria-hidden />
                      )}
                      <span className="min-w-0 max-w-[24rem] truncate">
                        {t("admin.inference.loadNamed", { name: effectiveUid || picked })}
                      </span>
                    </button>
                  )}
                  <Toggle
                    checked={autostart}
                    onChange={setAutostart}
                    label={t("admin.inference.alsoAutostart")}
                  />
                  {alreadyRunning && !bindRole && (
                    <span className="text-[11px] text-ink-subtle">
                      {t("admin.inference.noRoleForType")}
                    </span>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* 在途加载渲染在**选中项的条件之外**。放在第 3 段里面时它会跟着选择消失：
              提交完 A、切到 B（目录正在重取 ⇒ engineNames 短暂为空）或换个类型，
              A 的进度、百分比和失败原因就全不见了，而后台还在轮 —— 表现是「我点的那一下没发生过」。
              这一栏本来就按 uid 自报家门，放在这里不会张冠李戴。 */}
          {progress}
        </div>
      </div>
    </div>
  );
}

export default function AdminInference() {
  const { t } = useI18n();
  const confirm = useConfirm();
  // 只记「我提交过哪些加载」，落定与否每次渲染现算（见 openLaunches / movingLaunches）。
  const [launched, setLaunched] = useState<string[]>([]);
  const forgetLaunch = (uid: string) =>
    setLaunched((p) => (p.includes(uid) ? p.filter((u) => u !== uid) : p));
  const overview = useInferenceOverview(launched);
  const bind = useBindModel();
  const terminate = useTerminateModel();
  const setAuto = useSetAutostart();
  const relogin = useInferenceRelogin();
  const probe = useInferenceLiveness();

  const data = overview.data;
  const models = data?.models ?? NO_MODELS;
  const bindings = data?.bindings?.roles ?? [];
  const gpus = data?.gpu?.gpus ?? [];
  const launchErrors = data?.launch_errors ?? NO_LAUNCH_ERRORS;

  // 显示判据在这里；「还要不要继续轮」由 useInferenceOverview 就着它自己的读数算，
  // 两边用的是同一个模块里相邻的两个函数（openLaunches / movingLaunches）。
  const pending = useMemo(() => openLaunches(launched, data), [launched, data]);

  // 「我提交出去的加载」渲染在加载卡内部，而不是页面顶部另起一张面板：它是这张卡里
  // 那个按钮的直接后果。隔着两三屏远放一张进度表，用户点完按钮看到的仍是「什么都没发生」
  // —— 这一整轮的起点就是那个症状。它按 uid 自己报名字，所以切到别的型号也不会读错。
  const progressSlot =
    pending.length > 0 ? (
      <div className="flex min-w-0 flex-col gap-2 rounded-[--radius-md] border border-line-subtle bg-surface-sunken/40 px-3 py-2.5">
        <p className="text-[11px] font-medium text-ink-muted">
          {t("admin.inference.pendingTitle")}
        </p>
        <ul className="flex flex-col gap-2">
          {pending.map((uid) => (
            <PendingRow
              key={uid}
              uid={uid}
              models={models}
              error={launchErrors[uid]?.error}
              onDismiss={forgetLaunch}
            />
          ))}
        </ul>
      </div>
    ) : null;

  const autostartUids = useMemo(
    () =>
      new Set(
        (data?.autostart ?? [])
          .filter((a) => a.enabled !== false)
          .map((a) => a.launch?.model_uid || a.model_uid || "")
          .filter(Boolean),
      ),
    [data?.autostart],
  );

  // 目录清单要标出「哪个现在点就能起来」：权重在不在盘上、同名实例是不是已经在跑，
  // 都是服务器现报的事实，直接从这里取，不让用户自己回忆。
  const cachedNames = useMemo(
    () => new Set((data?.cached ?? []).map((c) => c.model_name || "").filter(Boolean)),
    [data?.cached],
  );
  // uid 与型号名两份判据一次算出来，调用点就没机会把它们用反（见 runningIndex）
  const running = useMemo(() => runningIndex(models), [models]);

  if (overview.isPending && !data) return <PageSkeleton rows={6} />;
  if (overview.error && !data)
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
        <Panel>
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        </Panel>
      </div>
    );

  const runningColumns: Column<RunningModel>[] = [
    {
      key: "model",
      header: t("admin.inference.colModel"),
      cell: (m) => {
        const uid = uidOf(m);
        return (
          <div className="min-w-0">
            <p className="truncate text-[--text-sm] text-ink" title={m.model_name || uid}>
              {m.model_name || uid}
            </p>
            {m.model_name && m.model_name !== uid && (
              <p className="truncate text-[11px] text-ink-subtle" title={uid}>
                {uid}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "type",
      header: t("admin.inference.colType"),
      width: "7rem",
      cell: (m) => <span className="text-[11px] text-ink-muted">{m.model_type || "—"}</span>,
    },
    {
      key: "engine",
      header: t("admin.inference.engine"),
      width: "9rem",
      hideBelow: "md",
      cell: (m) => <span className="text-[11px] text-ink-muted">{m.model_engine || "—"}</span>,
    },
    {
      key: "bound",
      header: t("admin.inference.colBound"),
      width: "7rem",
      hideBelow: "sm",
      cell: (m) => {
        const role = bindings.find((b) => b.model_uid === uidOf(m))?.role;
        return role ? (
          <StatusBadge tone="accent">{t(ROLE_LABEL_KEY[role])}</StatusBadge>
        ) : (
          <span className="text-[11px] text-ink-subtle">{t("common.none")}</span>
        );
      },
    },
    {
      key: "autostart",
      header: t("admin.inference.colAutostart"),
      width: "8.5rem",
      cell: (m) => {
        const uid = uidOf(m);
        // 只挡住**这一行**的提交：原来一次点击会让整列三个开关一起没反应，
        // 而界面上什么都没变 —— 看不出的等待会被读成「这个开关坏了」。
        const busy = setAuto.isPending && setAuto.variables?.uid === uid;
        return (
          <Toggle
            checked={autostartUids.has(uid)}
            disabled={busy}
            onChange={(v) => setAuto.mutate({ uid, enabled: v })}
            label={t("admin.inference.autostartLabel")}
          />
        );
      },
    },
    {
      key: "actions",
      header: "",
      width: "7rem",
      align: "right",
      cell: (m) => {
        const uid = uidOf(m);
        const boundRole = bindings.find((b) => b.model_uid === uid)?.role;
        return (
          <button
            type="button"
            className="a-btn a-btn-ghost !px-2 !py-1 text-danger"
            disabled={Boolean(boundRole) || terminate.isPending}
            // 禁用的时候必须说清为什么：一个说不出原因的禁用按钮和坏掉的按钮没区别。
            // `terminate.isPending` 是**共享**状态（一个 mutation 对象），所以别的行在卸载时
            // 这一行也会变灰 —— 那种灰必须说是为什么，否则看起来像这一行坏了。
            title={
              boundRole
                ? t("admin.inference.unloadBlockedHint", {
                    role: t(ROLE_LABEL_KEY[boundRole]),
                  })
                : terminate.isPending
                  ? t("admin.inference.busyElsewhere")
                  : t("admin.inference.unloadHint")
            }
            onClick={() =>
              confirm({
                title: t("admin.inference.unloadTitle", { name: instanceLabel(m) }),
                message: t("admin.inference.unloadMessage"),
                confirmLabel: t("admin.inference.unload"),
                tone: "danger",
              }).then((ok) =>
                ok
                  ? // 卸载成功后别再记着这次加载：否则它下一次不在运行清单时，
                    // 「在途」判据会把它当成还没起完，把轮询重新拉起来。
                    terminate.mutate(uid, { onSuccess: () => forgetLaunch(uid) })
                  : false,
              )
            }
          >
            <TrashIcon className="h-3.5 w-3.5" aria-hidden />
            {t("admin.inference.unload")}
          </button>
        );
      },
    },
  ];

  const weightColumns: Column<CachedWeight>[] = [
    {
      key: "name",
      header: t("admin.inference.colWeight"),
      cell: (c) => (
        <span className="text-[--text-sm] text-ink" title={c.model_name}>
          {c.model_name || "—"}
        </span>
      ),
    },
    {
      key: "type",
      header: t("admin.inference.colType"),
      width: "7rem",
      cell: (c) => <span className="text-[11px] text-ink-muted">{c.model_type || "—"}</span>,
    },
    {
      key: "version",
      header: t("admin.inference.colVersion"),
      hideBelow: "md",
      cell: (c) => (
        <span
          className="block max-w-[20rem] truncate text-[11px] text-ink-subtle"
          title={c.model_version || c.path || c.real_path || ""}
        >
          {c.model_version || c.path || c.real_path || "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      <div className="flex flex-col gap-4">
        <PageHeader
          breadcrumb={
            <Breadcrumbs
              items={[
                { label: t("page.dashboard"), to: "/dashboard" },
                { label: t("page.inference") },
              ]}
            />
          }
          title={t("admin.inference.title")}
          description={t("admin.inference.desc")}
          actions={
            <>
              <button
                type="button"
                className="a-btn a-btn-ghost"
                // 不能按 `isFetching` 禁用：加载中有 2.5 秒一次的后台轮询，那样这个按钮
                // 大部分时间都是灰的，而且没人知道为什么（图标转一下不是理由）。
                // react-query 对同键的重复请求本来就会合并，点它永远安全。
                onClick={() => void overview.refetch()}
                title={t("admin.inference.refreshHint")}
              >
                <RefreshIcon
                  className={overview.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
                />
                {t("admin.inference.refresh")}
              </button>
              <button
                type="button"
                className="a-btn a-btn-outline"
                onClick={() => relogin.mutate()}
                disabled={relogin.isPending}
                title={t("admin.inference.reloginHint")}
              >
                {t("admin.inference.relogin")}
              </button>
            </>
          }
        />

        {/* 状态条：一眼回答「这套东西通不通」 */}
        <div className="a-card flex flex-wrap divide-x divide-line-subtle">
          <StatCell
            label={t("admin.inference.server")}
            value={data?.version ? `Xinference ${data.version}` : (data?.endpoint ?? "—")}
            tone={data?.reachable ? "success" : "danger"}
            hint={data?.reachable ? (data.endpoint ?? undefined) : (data?.models_error ?? undefined)}
          />
          <StatCell
            label={t("admin.inference.credential")}
            // 四种状态分开说，因为它们是四件不同的事。
            // 「已拿到令牌但句柄还没建」不是「凭据缺失」：共享客户端现在是惰性的
            // （import 不碰网络），后端刚起来、还没人推理时它就是还没建。
            // 把那一格染成红色，等于让一个健康的系统看起来坏了。
            value={
              !data?.auth?.auth_required
                ? t("admin.inference.credentialAnon")
                : data?.client_has_credential
                  ? t("admin.inference.credentialOn")
                  : data?.auth?.has_token
                    ? t("admin.inference.credentialPending")
                    : t("admin.inference.credentialOff")
            }
            tone={
              !data?.auth?.auth_required ||
              data?.client_has_credential ||
              data?.auth?.has_token
                ? "success"
                : "danger"
            }
            hint={data?.auth?.last_error ?? undefined}
          />
          <StatCell
            label={t("admin.inference.running")}
            // 英文里 "1 models" 是错的，而中文两边同形 —— 单复数只能用文案键表达，
            // 不能在代码里拼 "model" + (n>1 ? "s" : "")。
            value={
              models.length === 1
                ? t("admin.inference.runningOne")
                : t("admin.inference.runningCount", { n: models.length })
            }
            tone={models.length ? "success" : "warning"}
          />
          {gpus.map((g) => (
            <div key={g.id} className="min-w-0 flex-1 px-4 py-3">
              <p className="truncate text-[11px] text-ink-subtle" title={g.name}>
                {t("admin.inference.vram")} · {g.name ?? g.id}
              </p>
              <div className="mt-1.5">
                <MemBar used={g.mem_used} total={g.mem_total} />
              </div>
            </div>
          ))}
        </div>

        {/* 角色绑定：这页真正会改变系统行为的地方 */}
        <Panel
          title={t("admin.inference.bindingTitle")}
          description={t("admin.inference.bindingDesc")}
          bodyClass="divide-y divide-line-subtle"
        >
          {ROLES.map((role) => {
            const b = bindings.find((x) => x.role === role);
            return (
              <BindingRow
                key={role}
                role={role}
                models={models}
                currentUid={b?.model_uid ?? ""}
                fromSettings={Boolean(b?.from_settings)}
                onPick={(uid, name) => bind.mutate({ role, uid, name })}
              />
            );
          })}
        </Panel>

        {/* 活性探测：这条面板存在的唯一理由是「绑定在表里、注册表里有」都不等于「能出字」。
            本机那次 CUDA sticky 事故里，总览与 /health 全程绿灯，而请求成片回空回答。 */}
        <Panel
          title={t("admin.inference.probeTitle")}
          description={t("admin.inference.probeDesc")}
          bodyClass="divide-y divide-line-subtle"
          actions={
            <button
              type="button"
              className="a-btn a-btn-outline"
              onClick={() => probe.mutate()}
              disabled={probe.isPending}
              title={t("admin.inference.probeHint")}
            >
              {probe.isPending
                ? t("admin.inference.probing")
                : t("admin.inference.probeRun")}
            </button>
          }
        >
          {probeCounts(probe.data?.probes).total === 0 ? (
            <div className="px-4 py-4">
              <EmptyState
                title={t("admin.inference.probeEmpty")}
                description={t("admin.inference.probeEmptyDesc")}
              />
            </div>
          ) : (
            (probe.data?.probes ?? []).map((p) => (
              <div key={p.role} className="flex items-start gap-3 px-4 py-3">
                <StatusBadge tone={probeToneOf(p)}>
                  {p.ok ? t("admin.inference.probeOk") : t("admin.inference.probeBad")}
                </StatusBadge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {t(ROLE_LABEL_KEY[p.role])} · {p.model_uid || "—"}
                    {p.latency_ms != null ? ` · ${p.latency_ms} ms` : ""}
                  </p>
                  <p className="mt-1 break-words text-xs text-ink-subtle">{p.detail}</p>
                </div>
              </div>
            ))
          )}
        </Panel>

        <Panel
          title={t("admin.inference.runningTitle")}
          description={t("admin.inference.runningDesc")}
          bodyClass="p-0"
        >
          <DataTable
            columns={runningColumns}
            rows={models}
            rowKey={(m) => uidOf(m)}
            loading={overview.isFetching && !models.length}
            empty={
              <EmptyState
                icon={LayersIcon}
                title={t("admin.inference.noneRunning")}
                description={t("admin.inference.noneRunningDesc")}
              />
            }
          />
        </Panel>

        <Panel
          title={t("admin.inference.catalogTitle")}
          description={t("admin.inference.catalogDesc")}
        >
          <CatalogLoader
            onLaunched={(uid) =>
              setLaunched((p) => (p.includes(uid) ? p : [...p, uid]))
            }
            onBind={(role, modelUid, name) => bind.mutate({ role, uid: modelUid, name })}
            cachedNames={cachedNames}
            runningUids={running.uids}
            runningModelNames={running.names}
            appMaxLen={data?.app?.max_model_len}
            progress={progressSlot}
          />
        </Panel>

        <Panel
          title={t("admin.inference.weightsTitle")}
          description={t("admin.inference.weightsDesc")}
          bodyClass="p-0"
        >
          <DataTable
            columns={weightColumns}
            rows={data?.cached ?? []}
            rowKey={(c) => `${c.model_name}-${c.model_version ?? ""}-${c.path ?? ""}`}
            empty={
              <EmptyState
                icon={DatabaseIcon}
                title={t("admin.inference.cachedEmpty")}
                description={t("admin.inference.cachedEmptyDesc")}
              />
            }
          />
        </Panel>

        {(data?.downloads?.length ?? 0) > 0 && (
          <Panel title={t("admin.inference.downloading")}>
            <ul className="flex flex-col gap-2 px-4 py-3">
              {data?.downloads.map((d) => (
                <li key={d.cache_uid ?? d.model_name} className="flex items-center gap-3">
                  <UploadIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <span
                    className="min-w-0 flex-1 truncate text-[--text-sm]"
                    title={d.model_name}
                  >
                    {d.model_name}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-subtle tnum">
                    {typeof d.progress === "number"
                      ? `${Math.round(d.progress * 100)}%`
                      : d.status || t("common.unknown")}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {data && !data.reachable && (
          <p className="flex items-start gap-2 text-[11px] text-danger">
            <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("admin.inference.unreachable", { endpoint: data.endpoint ?? "—" })}
          </p>
        )}
      </div>
    </div>
  );
}
