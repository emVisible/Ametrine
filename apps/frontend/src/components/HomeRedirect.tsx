import { Navigate } from "react-router";
import { useCurrentUser } from "../hooks/useAuth";
import { homePathFor } from "../utils/home";
import { Loading } from "./ui";

export default function HomeRedirect() {
  const { data, isPending } = useCurrentUser();
  if (isPending) return <Loading />;
  return <Navigate to={homePathFor(data)} replace />;
}
