"use client";

import Link from "next/link";
import { Bot, Eye, FileKey2, GitBranch, Scale, ShieldCheck, Users } from "lucide-react";
import type { Project } from "@/types/hub";
import {
  normalizeProjectPublicTabVisibility,
  PROJECT_PUBLIC_TAB_LABELS,
  type ProjectPublicTabId,
  type ProjectPublicTabVisibility,
} from "@/lib/projects/settings-policies";

type Props = {
  project: Project;
  isOwner: boolean;
  isOwnerOrMember: boolean;
  publicTabVisibility?: ProjectPublicTabVisibility | null;
};

const legalLinks = [
  ["Privacy Policy", "/privacy"],
  ["Terms of Service", "/terms"],
  ["End User Licence Agreement", "/eula"],
  ["Acceptable Use Policy", "/acceptable-use"],
  ["Copyright & IP", "/copyright"],
] as const;

function Card({ icon: Icon, title, children }: { icon: typeof Eye; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="rounded-2xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
      </div>
      <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{children}</div>
    </section>
  );
}

export default function ProjectPrivacyTermsTab({ project, isOwner, isOwnerOrMember, publicTabVisibility }: Props) {
  const publicTabs = normalizeProjectPublicTabVisibility(publicTabVisibility ?? project.publicTabVisibility);
  const visiblePublicTabs = (Object.keys(publicTabs) as ProjectPublicTabId[])
    .filter((tab) => publicTabs[tab])
    .map((tab) => PROJECT_PUBLIC_TAB_LABELS[tab]);
  const isPublic = project.visibility === "public";
  const viewerRole = isOwner ? "project owner" : isOwnerOrMember ? "project collaborator" : "visitor";
  const hasRepository = Boolean((project as Project & { githubRepoUrl?: string | null; repositoryUrl?: string | null }).githubRepoUrl
    || (project as Project & { repositoryUrl?: string | null }).repositoryUrl);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="rounded-[2rem] border border-zinc-200 bg-gradient-to-br from-white to-indigo-50/60 p-6 dark:border-zinc-800 dark:from-zinc-900 dark:to-indigo-950/20 sm:p-8">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-300">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" /> Project notice
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-3xl">Privacy & terms for {project.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          This page explains how NetworkBase’s platform rules apply in this project. You are viewing it as a {viewerRole}. It supplements—not replaces—the service-wide legal documents below.
        </p>
      </header>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Card icon={Eye} title="Who can see this project">
          <p>This project is currently <strong className="text-zinc-900 dark:text-zinc-100">{isPublic ? "public" : "private"}</strong>.</p>
          {isPublic ? (
            <p>Visitors may see these enabled public areas: {visiblePublicTabs.length ? visiblePublicTabs.join(", ") : "none at present"}. Project members may see additional workspace areas.</p>
          ) : (
            <p>Project content is limited to authorized members, except for minimal project information required to route access requests and enforce security.</p>
          )}
          <p>Changing a project’s visibility does not make direct messages, account credentials, private drafts, or deleted-file recovery areas public.</p>
        </Card>

        <Card icon={Users} title="Owner and member responsibilities">
          <p>The project owner controls membership, roles, public-tab visibility, integrations, and project deletion. Members must only upload or share material they are authorized to use.</p>
          <p>Do not place passwords, API keys, health records, government identifiers, payment-card data, or other regulated/confidential data in public fields or public files.</p>
          <p>Removing a person stops future access but does not automatically erase copies they lawfully downloaded while they had access.</p>
        </Card>

        <Card icon={FileKey2} title="Files, activity and deletion">
          <p>Files, tasks, docs, updates, comments, revisions, audit events, and recovery records are processed to operate and secure the workspace. Other authorized collaborators may receive or modify shared content.</p>
          <p>Deletion may first move content to a recoverable state. Backups, security logs, legal evidence, and content another participant needs may remain for the limited periods in the Privacy Policy.</p>
          <p>A project owner should export required material before deleting the project or their account.</p>
        </Card>

        <Card icon={GitBranch} title="Connected services">
          <p>{hasRepository ? "This project appears to have a source-code repository connection." : "This project may connect to source-code or other third-party services."} A connection can transfer repository metadata, files, commit identity, and synchronization status according to the permissions granted to that provider.</p>
          <p>Disconnecting an integration stops future access where supported; it may not delete data already imported into this project or retained by the provider.</p>
        </Card>

        <Card icon={Bot} title="AI-assisted features">
          <p>If a member invokes an AI feature, the submitted prompt and necessary project context may be sent to the disclosed AI provider to generate a response. AI output can be incomplete or incorrect and must be reviewed before use.</p>
          <p>Do not submit secrets or personal data unless it is necessary, permitted, and appropriate for the project.</p>
        </Card>

        <Card icon={Scale} title="Ownership, licences and complaints">
          <p>Creators retain ownership of their content, while granting NetworkBase the limited licence needed to host, display, secure, and transmit it. Public or collaborative sharing also authorizes access by the audience selected by the owner.</p>
          <p>Report unlawful, abusive, or infringing content through the channels in the Acceptable Use and Copyright policies. This project notice is not an NDA or a substitute for a team’s separate commercial agreement.</p>
        </Card>
      </div>

      <section className="mt-6 rounded-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">Applicable documents</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {legalLinks.map(([label, href]) => (
            <Link key={href} href={href} target="_blank" className="rounded-full border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-indigo-700 dark:hover:text-indigo-300">
              {label}
            </Link>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-zinc-500">If this summary conflicts with an applicable legal document, the legal document controls.</p>
      </section>
    </div>
  );
}
