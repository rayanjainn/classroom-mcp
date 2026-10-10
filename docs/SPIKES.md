# Phase 0 spikes: runbook

Record the result under each spike (pass / fail / notes).

## S1. Attach / turn-in on teacher-created work
1. In the test class, as a student, get an OAuth token with `classroom.coursework.me`.
2. Call `courses.courseWork.studentSubmissions.modifyAttachments` and `turnIn` on a teacher-made assignment.
3. Expected: `PERMISSION_DENIED`. Result:

## S2. File access with Classroom + drive.file + documents
1. Read the student's own "make a copy" Doc through the Docs API.
2. Read a teacher-attached Drive file without the Picker.
3. Result (which succeed, which need the Picker):

## S3. Docs batchUpdate formatting
Fill placeholders and a table in a styled template; compare before and after visually. Result:

## S4. AI client matrix
Add `https://mcp.classroom.raycode.tech/mcp` as a custom connector in Claude, ChatGPT and Gemini. Record plan tier, whether OAuth completes, and whether tools are listed.

## S9. Workers Free limits
Run a full course-overview call set; record CPU time and subrequest count per invocation.

## S11. Billing requirement
Note whether Google Cloud demanded a billing account to enable the APIs and create the OAuth client.

## S12. Testing-mode refresh tokens
Note the date a refresh token was issued; retry it after 8 days.
