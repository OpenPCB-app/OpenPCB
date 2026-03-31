import type { ReactNode } from "react";
import { useAuthStore } from "@/stores/auth-store";

interface FeatureGateProps {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const features = useAuthStore((s) => s.features);
  if (!features.includes(feature) && !features.includes("*")) {
    return fallback ?? null;
  }
  return children;
}
