"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SchedulerRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/planning"); }, [router]);
  return null;
}
