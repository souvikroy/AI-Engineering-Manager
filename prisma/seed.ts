import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const dataDir = path.resolve(__dirname, "..", "data");

function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")) as T;
}

type Engineer = {
  id: string;
  name: string;
  role: string;
  level: string;
  joinedAt: string;
  slackHandle: string;
  githubHandle: string;
};

async function main() {
  // SAFETY: never wipe production data. Real ingest writes will land in BriefSnapshot,
  // PRReview, Finding, Postmortem etc. once Phase 3+ ships. Require an explicit --demo
  // flag or non-production env to allow the destructive reset.
  const allowReset =
    process.env.NODE_ENV !== "production" || process.argv.includes("--demo");
  if (!allowReset) {
    throw new Error(
      "prisma/seed.ts refuses to deleteMany() in NODE_ENV=production. Re-run with --demo if you really mean to reset.",
    );
  }

  await prisma.finding.deleteMany();
  await prisma.pRReview.deleteMany();
  await prisma.postmortem.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.oneOnOne.deleteMany();
  await prisma.briefSnapshot.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.designDoc.deleteMany();
  await prisma.oKR.deleteMany();
  await prisma.engineer.deleteMany();
  await prisma.team.deleteMany();

  const teams = read<{ teams: { id: string; name: string; mission: string; engineers: Engineer[] }[] }>("teams.json");
  for (const t of teams.teams) {
    await prisma.team.create({ data: { id: t.id, name: t.name, mission: t.mission } });
    for (const e of t.engineers) {
      await prisma.engineer.create({
        data: {
          id: e.id,
          name: e.name,
          role: e.role,
          level: e.level,
          teamId: t.id,
          joinedAt: new Date(e.joinedAt),
          slackHandle: e.slackHandle,
          githubHandle: e.githubHandle,
        },
      });
    }
  }

  const oneOnOnes = read<{ history: { engineerId: string; date: string; topics: string; commitments: string; sentiment: string; notes: string }[] }>("one_on_ones.json");
  for (const o of oneOnOnes.history) {
    await prisma.oneOnOne.create({
      data: {
        engineerId: o.engineerId,
        date: new Date(o.date),
        topics: o.topics,
        commitments: o.commitments,
        sentiment: o.sentiment,
        notes: o.notes,
      },
    });
  }

  const okrs = read<{ team_okrs: { id: string; teamId: string; objective: string; keyResults: string[]; progress: number; status: string }[]; quarter: string }>("okrs.json");
  for (const k of okrs.team_okrs) {
    await prisma.oKR.create({
      data: {
        id: k.id,
        teamId: k.teamId,
        objective: k.objective,
        keyResults: JSON.stringify(k.keyResults),
        progress: k.progress,
        quarter: okrs.quarter,
        status: k.status,
      },
    });
  }

  const monitoring = read<{ alerts: { id: string; service: string; severity: string; status: string; openedAt: string; resolvedAt?: string; title: string; ownerId: string; thread: string }[] }>("monitoring.json");
  for (const a of monitoring.alerts) {
    await prisma.incident.create({
      data: {
        id: a.id,
        title: a.title,
        severity: a.severity,
        status: a.status,
        openedAt: new Date(a.openedAt),
        resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : null,
        summary: a.thread,
        ownerId: a.ownerId,
        alerts: JSON.stringify({ service: a.service }),
      },
    });
  }

  console.log("Seeded:", {
    teams: await prisma.team.count(),
    engineers: await prisma.engineer.count(),
    oneOnOnes: await prisma.oneOnOne.count(),
    okrs: await prisma.oKR.count(),
    incidents: await prisma.incident.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
