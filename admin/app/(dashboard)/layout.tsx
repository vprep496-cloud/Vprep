import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import DashboardShell from "./dashboard-shell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  return <DashboardShell session={session}>{children}</DashboardShell>;
}
