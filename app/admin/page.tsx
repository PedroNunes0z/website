import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { getArticles } from "@/lib/articles";
import { isAdminSession } from "@/lib/auth";
import { hasPersistentStorage } from "@/lib/redis";

export const metadata: Metadata = {
  title: "Painel editorial",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdminSession())) redirect("/admin/login");

  return (
    <AdminDashboard
      initialArticles={await getArticles({ includeDrafts: true })}
      storageConfigured={hasPersistentStorage()}
    />
  );
}
