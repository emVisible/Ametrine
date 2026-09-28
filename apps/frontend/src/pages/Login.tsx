// src/pages/Login.tsx
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useLogin } from "../hooks/useAuth";
import { safeRedirect } from "../utils/redirect";
import { pageTitleForPath } from "../utils/pageTitles";
import { AuthField, AuthScreen, AuthSubmit } from "../components/AuthScreen";

export default function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [errorMessage, setErrorMessage] = useState("");

  const from = safeRedirect((location.state as { from?: string } | null)?.from);
  // 被守卫拦下来时告诉用户登录后会去哪，而不是默默回到概览
  const backTo = from === "/dashboard" ? null : pageTitleForPath(from);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage("");
    const formData = new FormData(e.currentTarget);
    const username = (formData.get("username") as string)?.trim() ?? "";
    const password = (formData.get("password") as string) ?? "";
    if (!username || !password) {
      setErrorMessage("请填写账号和密码");
      return;
    }
    try {
      await login.mutateAsync({ username, password });
      navigate(from, { replace: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "登录失败，请检查账号和密码",
      );
    }
  };

  return (
    <AuthScreen
      title="登录"
      subtitle={backTo ? `登录后返回「${backTo}」` : "本地知识库与检索对话"}
      error={errorMessage}
      footer={
        <>
          还没有账号？
          <Link to="/register" className="ml-1 text-accent-ink hover:underline">
            创建账号
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <AuthField
          id="username"
          name="username"
          label="账号"
          type="text"
          autoComplete="username"
          placeholder="邮箱或用户名"
          required
        />
        <AuthField
          id="password"
          name="password"
          label="密码"
          type="password"
          autoComplete="current-password"
          placeholder="输入密码"
          required
        />
        <AuthSubmit pending={login.isPending} pendingLabel="登录中…">
          登录
        </AuthSubmit>
      </form>
    </AuthScreen>
  );
}
