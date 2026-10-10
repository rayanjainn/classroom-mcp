# ClassroomPilot

A remote MCP server that connects a student's own AI assistant to Google Classroom. It reads assignments, rubrics, announcements and attached files, prepares documents (LaTeX, Google Docs), fills the student's own template copy after a preview-and-approve step, and hands over to the student for Turn In.

- `apps/gateway`: Cloudflare Worker with the MCP endpoint (`/mcp`), OAuth, Overleaf hand-off and file-picker API
- `apps/web`: static site (home, privacy, terms) and the file picker page (`/pick/`)
- `packages/shared`: the DocSpec schema
- `docs/`: [DEPLOY](docs/DEPLOY.md), [GOOGLE_SETUP](docs/GOOGLE_SETUP.md), [PICKER](docs/PICKER.md), [SPIKES](docs/SPIKES.md)

## Tools (25)

| Group | Tools |
|---|---|
| Classroom | `list_courses`, `get_course_overview`, `list_assignments`, `get_assignment_bundle`, `list_announcements`, `list_materials`, `list_topics`, `get_stream`, `search_course_context`, `get_rubric`, `get_grades`, `get_submission_status` |
| Files | `read_attachment` (Google files directly; PDF/Word via the picker) |
| Profile | `get_profile`, `update_profile`, `delete_my_data`, `map_profile_to_template` |
| Documents | `analyze_template`, `render_document` (LaTeX with Overleaf link, or a new Google Doc), `edit_student_doc` (append, replace, **delete sections / ranges / text / everything**; preview shows the exact words to be removed, then confirm) |
| Figures | inside documents: charts, flow diagrams, **terminal sessions** (Ubuntu, macOS, PowerShell, cmd, VS Code; real ANSI colours; LaTeX and Google Docs) and **UI mockups** (browser or app window; LaTeX). Each is marked `captured` (real output) or `illustrative` (caption says simulated) |
| Hand-off | `check_requirements`, `prepare_submission`, `verify_turned_in`, `weekly_plan`, `whoami` |

## Develop

```
npm install
npm run typecheck
npm test          # unit tests + an end-to-end run of all tools against a fake Google
npm run dev       # local gateway on :8787 (needs apps/gateway/.dev.vars)
```

Rendering a LaTeX test document needs a TeX install (`tests/render-sample.ts` writes a `.tex` you can compile).
