# Google Cloud setup (everything in one place)

**APIs to enable** (APIs & Services > Library): Google Classroom API, Google Docs API, Google Slides API, Google Sheets API, Google Drive API, Google Picker API (only for the file picker).

**OAuth web client** (Google Auth Platform > Clients):
- Authorized redirect URIs: `https://mcp.classroom.raycode.tech/callback` (and `http://localhost:8787/callback` for local dev)
- Authorized JavaScript origins: `https://classroom.raycode.tech` (the file picker page signs in from there)

**Consent screen > Data Access** (add every scope; `SCOPE_VERSION` in `apps/gateway/src/google.ts` forces everyone to re-consent when this list changes):

| Scope | Why |
|---|---|
| `openid`, `email`, `profile` | identity |
| `classroom.courses.readonly` | course list |
| `classroom.coursework.me.readonly` | assignments |
| `classroom.student-submissions.me.readonly` | submission state and the student's own files |
| `classroom.courseworkmaterials.readonly` | class materials |
| `classroom.announcements.readonly` | stream posts |
| `classroom.topics.readonly` | topics |
| `documents` | read attached Docs; edit the student's own submission Doc after approval; create new Docs |
| `presentations.readonly`, `spreadsheets.readonly` | read attached Slides and Sheets |
| `drive.file` | create files and a ClassroomPilot folder; open files the student picks (non-sensitive scope) |

No restricted scope (`drive`, `drive.readonly`, Gmail) is used, so no paid security assessment is needed. `documents`, `presentations.readonly`, `spreadsheets.readonly` and the Classroom scopes are *sensitive*: they need Google's free OAuth verification before more than 100 users can connect.

**Branding**: app name must not start with "Google"; homepage `https://classroom.raycode.tech/`, privacy `/privacy/`, terms `/terms/`, authorized domain `raycode.tech`.
