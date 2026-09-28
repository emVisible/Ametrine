// src/components/ProtectedRoute.tsx
// 守卫只回答两个问题：登录了吗、这个角色能进吗。
// 之前 useCurrentUser 的任何错误都会把人踢到 /login 并丢掉来路，
// 但 401 早就由 apiClient 清掉登录态了（isAuthenticated 变 false），
// 剩下的错误其实是「后端在重启 / 网络抖了一下」——token 仍然有效，
// 该做的是原地重试，而不是把用户赶出去。
import { Navigate, Outlet, useLocation } from "react-router";
import useAuthStore from "../stores/useAuthStore";
import { useCurrentUser } from "../hooks/useAuth";
import { ErrorState, Loading } from "./ui";

export function ProtectedRoute({
  requiredRoles,
}: {
  requiredRoles?: string[];
}) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const { isPending, isError, error, refetch } = useCurrentUser();

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  // 首次进入时 /user/me 还在飞：直接放行会先渲染出「非管理员」的导航再补上，
  // 角色徽章和菜单会闪一下
  if (isPending) return <Loading label="正在确认身份…" />;

  if (isError) {
    return (
      <div className="anim-page">
        <ErrorState
          title="暂时读不到你的账号信息"
          error={error}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (requiredRoles && user) {
    const hasRole = requiredRoles.some((role) => user.permissions.includes(role));
    if (!hasRole) return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
