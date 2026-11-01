"use client";
import { useParams } from "next/navigation";
import ChallengeRoom from "@/components/ChallengeRoom";

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  return <ChallengeRoom id={id} />;
}
