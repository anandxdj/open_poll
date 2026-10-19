import apiClient from "@/lib/api-client";
import type { AuditFilters, AuditPage } from "../types";

export async function listAuditEvents(filters: AuditFilters = {}) {
  const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""));
  const res = await apiClient.get<{ data: AuditPage }>("/audit", { params });
  return res.data.data;
}
