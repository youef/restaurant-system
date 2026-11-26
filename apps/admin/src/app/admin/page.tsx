import { StaffGuard } from "@restaurant/db";
import { AdminConsole } from "./console";

export default async function AdminPage() {
  return <StaffGuard allowedRoles={["admin"]}><AdminConsole /></StaffGuard>;
}
