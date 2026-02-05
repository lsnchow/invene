'use client'

import { BeanOrchestrator } from "@/components/bean-orchestrator";
import { Leva } from "leva";

export default function Home() {
  return (
    <>
      <BeanOrchestrator />
      <Leva hidden />
    </>
  );
}
