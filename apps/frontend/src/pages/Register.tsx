// src/pages/Register.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useI18n } from "../i18n/context";
import { AuthField, AuthScreen, AuthSubmit } from "../components/AuthScreen";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState("");

  const register = useMutation({
    mutationFn: (data: { name: string; password: string; email?: string }) =>
      apiClient("/user/create", { method: "POST", body: data }),
    onSuccess: () => navigate("/login"),
    onError: (error: Error) =>
      // 后端回的是英文短语，直接透出在两种语言里都像 bug，先归一成自己的文案
      setErrorMessage(
        /exist|已存在|duplicate|taken|已注册/i.test(error.message)
          ? t("auth.nameTaken")
          : error.message,
      ),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage("");
    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string)?.trim() ?? "";
    const password = (formData.get("password") as string) ?? "";
    const email = (formData.get("email") as string)?.trim() ?? "";
    if (!name || !password) {
      setErrorMessage(t("auth.needUserPass"));
      return;
    }
    register.mutate({ name, password, email: email || undefined });
  };

  return (
    <AuthScreen
      titleKey="auth.registerTitle"
      taglineKey="auth.registerTagline"
      error={errorMessage || (register.isSuccess ? t("auth.registered") : "")}
      footer={
        <>
          {t("auth.haveAccount")}
          <Link to="/login" className="ml-1 text-accent-ink hover:underline">
            {t("auth.backToLogin")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <AuthField
          id="name"
          name="name"
          label={t("auth.username")}
          autoComplete="username"
          placeholder={t("auth.usernamePlaceholder")}
          required
        />
        <AuthField
          id="password"
          name="password"
          label={t("auth.password")}
          type="password"
          autoComplete="new-password"
          placeholder={t("auth.passwordPlaceholder")}
          required
        />
        <AuthField
          id="email"
          name="email"
          label={t("auth.email")}
          type="email"
          autoComplete="email"
          optional={t("auth.optionalField")}
        />
        <AuthSubmit
          pending={register.isPending}
          pendingLabel={t("auth.submittingShort")}
        >
          {t("auth.submitRegister")}
        </AuthSubmit>
      </form>
    </AuthScreen>
  );
}
