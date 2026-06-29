// Command reference — ports the legacy dashboard's COMMANDS catalog (career-ops
// CLI + interview-coach skill). Surfaced in the ⌘K palette as copyable commands.

export type Command = { cmd: string; label: string; desc: string };
export type CommandGroup = { group: string; commands: Command[] };

export const COMMAND_CATALOG: CommandGroup[] = [
  {
    group: "career-ops",
    commands: [
      { cmd: "/career-ops oferta {url}", label: "Evaluate offer", desc: "Full A–G scored evaluation + report + tracker entry." },
      { cmd: "/career-ops pipeline", label: "Process inbox", desc: "Evaluate every pending URL in pipeline.md." },
      { cmd: "/career-ops scan", label: "Deep scan (agent)", desc: "WebSearch + Playwright scan across all queries." },
      { cmd: "/career-ops deep {company}", label: "Deep research", desc: "Company deep-dive: funding, culture, eng blog, interview signals." },
      { cmd: "/career-ops contacto {company}", label: "LinkedIn outreach", desc: "Find hiring contacts + draft personalized outreach." },
      { cmd: "/career-ops pdf {company}", label: "Tailored CV PDF", desc: "ATS-optimized CV PDF tailored to an evaluated offer." },
      { cmd: "/career-ops apply {url}", label: "Apply assistant", desc: "Live form-filling assistant — drafts answers, STOPS before submit." },
      { cmd: "/career-ops interview-prep {company}", label: "Interview intel", desc: "Company-specific interview prep report." },
      { cmd: "/career-ops followup", label: "Follow-up coach", desc: "Cadence advice + drafts for overdue follow-ups." },
      { cmd: "/career-ops patterns", label: "Rejection patterns", desc: "Analyze outcomes to improve targeting." },
    ],
  },
  {
    group: "interview-coach",
    commands: [
      { cmd: "prep {company}", label: "Prep brief", desc: "Company + role prep brief with story mapping." },
      { cmd: "mock {format}", label: "Mock interview", desc: "Full simulated interview, 4–6 questions, scored." },
      { cmd: "practice", label: "Practice drills", desc: "Drill menu: DSA cadence, ramble control, depth." },
      { cmd: "debrief", label: "Post-interview debrief", desc: "Same-day rapid capture after a real round." },
      { cmd: "stories", label: "Storybank work", desc: "Build / improve / retire STAR+R stories." },
      { cmd: "hype", label: "Pre-interview hype", desc: "Confidence + 3×3 plan — run within 48h of interview." },
      { cmd: "salary", label: "Comp coaching", desc: "Early/mid-process compensation conversations." },
      { cmd: "negotiate", label: "Negotiate offer", desc: "Post-offer negotiation coaching." },
      { cmd: "feedback {what}", label: "Report outcome", desc: "Capture recruiter feedback / report an outcome." },
    ],
  },
];
