"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PianiManutenzioneRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/piani");
  }, [router]);
  return null;
}
