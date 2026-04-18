# Public Dashboard Privacy

Career-Ops Dashboard is designed to process career data locally.

- The public repository must contain only system code and fictional examples.
- Resume and profile files are ignored by Git.
- The local web server binds to `127.0.0.1` unless the user deliberately changes
  `CAREER_DASHBOARD_HOST`.
- The dashboard must never submit a job application automatically.
- Resume replacement must require review and explicit confirmation.
- Uploaded files must never be executed.
- Uploaded resumes are staged under ignored `data/onboarding-drafts/` storage.
- Staging an upload never changes the active profile.
- PDF and DOCX extraction runs locally without uploading resume content to an
  AI provider or external parsing service.

Before publishing changes:

```powershell
npm run dashboard:audit
git status --short
git diff --check
```
