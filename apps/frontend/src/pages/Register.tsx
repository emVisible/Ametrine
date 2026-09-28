// src/pages/Register.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { AuthField, AuthScreen, AuthSubmit } from "../components/AuthScreen";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState("");

  const register = useMutation({
    mutationFn: (data: { name: string; password: string; email?: string }) =>
      apiClient("/user/create", { method: "POST", body: data }),
    onSuccess: () => navigate("/login"),
    onError: (error: Error) =>
      // 后端回的是英文短语，直接透出会在中文界面里显得像 bug
      setErrorMessage(
        /exist|已存在|duplicate|taken|已注册/i.test(error.message)
          ? "该用户名已经被注册，换一个试试"
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
      setErrorMessage("请填写用户名和密码");
      return;
    }
    register.mutate({ name, password, email: email || undefined });
  };

  return (
    <AuthScreen
      title="创建账号"
      subtitle="注册后由管理员分配知识库与租户权限"
      error={errorMessage || (register.isSuccess ? "注册成功，请登录" : "")}
      footer={
        <>
          已有账号？
          <Link to="/login" className="ml-1 text-accent-ink hover:underline">
            返回登录
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <AuthField
          id="name"
          name="name"
          label="用户名"
          autoComplete="username"
          required
        />
        <AuthField
          id="password"
          name="password"
          label="密码"
          type="password"
          autoComplete="new-password"
          required
        />
        <AuthField
          id="email"
          name="email"
          label="邮箱"
          type="email"
          autoComplete="email"
          optional="选填"
        />
        <AuthSubmit pending={register.isPending} pendingLabel="提交中…">
          注册
        </AuthSubmit>
      </form>
    </AuthScreen>
  );
}
