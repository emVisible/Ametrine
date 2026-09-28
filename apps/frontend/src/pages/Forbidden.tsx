// src/pages/Forbidden.tsx
import { Link } from "react-router";
import { EmptyState } from "../components/ui";
import { ShieldIcon } from "../components/icons";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 py-10 md:px-8">
      <div className="a-card">
        <EmptyState
          icon={ShieldIcon}
          title="这个页面需要管理员权限"
          description="组织与权限只对管理员开放。需要访问的话，请让现有管理员把你的角色提升为管理员。"
          action={
            <Link to="/dashboard" className="a-btn a-btn-primary">
              返回概览
            </Link>
          }
        />
      </div>
    </div>
  );
}
