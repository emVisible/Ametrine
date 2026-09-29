// src/pages/Forbidden.tsx
import { Link } from "react-router";
import { EmptyState } from "../components/ui";
import { ShieldIcon } from "../components/icons";
import { useI18n } from "../i18n/context";

export default function ForbiddenPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 py-10 md:px-8">
      <div className="a-card">
        <EmptyState
          icon={ShieldIcon}
          title={t("forbidden.title")}
          description={t("forbidden.desc")}
          action={
            <Link to="/dashboard" className="a-btn a-btn-primary">
              {t("forbidden.back")}
            </Link>
          }
        />
      </div>
    </div>
  );
}
