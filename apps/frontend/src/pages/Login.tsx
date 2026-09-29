// src/pages/Login.tsx
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useLogin } from "../hooks/useAuth";
import { safeRedirect } from "../utils/redirect";
import { pageTitleForPath } from "../utils/pageTitles";
import { useI18n } from "../i18n/context";
import { AuthField, AuthScreen, AuthSubmit } from "../components/AuthScreen";

export default function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState("");

  const from = safeRedirect((location.state as { from?: string } | null)?.from);
  // 被守卫拦下来时告诉用户登录后会去哪（文案键），而不是默默回到概览
  const backTo = from === "/dashboard" ? null : pageTitleForPath(from);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage("");
    const formData = new FormData(e.currentTarget);
    const username = (formData.get("username") as string)?.trim() ?? "";
    const password = (formData.get("password") as string) ?? "";
    if (!username || !password) {
      setErrorMessage(t("auth.needBoth"));
      return;
    }
    try {
      await login.mutateAsync({ username, password });
      navigate(from, { replace: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("auth.failed"),
      );
    }
  };

  return (
    <AuthScreen
      titleKey="auth.loginTitle"
      taglineKey="auth.loginTagline"
      returnToKey={backTo}
      error={errorMessage}
      footer={
        <>
          {t("auth.noAccount")}
          <Link to="/register" className="ml-1 text-accent-ink hover:underline">
            {t("auth.createAccount")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <AuthField
          id="username"
          name="username"
          label={t("auth.account")}
          type="text"
          autoComplete="username"
          placeholder={t("auth.accountPlaceholder")}
          required
        />
        <AuthField
          id="password"
          name="password"
          label={t("auth.password")}
          type="password"
          autoComplete="current-password"
          placeholder={t("auth.passwordPlaceholder")}
          required
        />
        <AuthSubmit pending={login.isPending} pendingLabel={t("auth.submitting")}>
          {t("auth.submit")}
        </AuthSubmit>
      </form>
    </AuthScreen>
  );
}
