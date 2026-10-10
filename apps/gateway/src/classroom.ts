import { gget } from "./google.js";

const BASE = "https://classroom.googleapis.com/v1";

/** Follow nextPageToken up to maxPages, collecting `key` arrays. */
async function paged<T>(token: string, url: string, key: string, params: Record<string, string | number | undefined>, maxPages = 2): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const data = await gget<Record<string, any>>(token, url, { ...params, pageToken });
    out.push(...((data[key] as T[] | undefined) ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export const listCourses = (token: string, includeArchived = false) =>
  paged<any>(token, `${BASE}/courses`, "courses", {
    studentId: "me",
    courseStates: includeArchived ? undefined : "ACTIVE",
    pageSize: 50,
    fields: "nextPageToken,courses(id,name,section,descriptionHeading,description,room,courseState,alternateLink,calendarId)",
  });

export const listTopics = (token: string, courseId: string) =>
  paged<any>(token, `${BASE}/courses/${courseId}/topics`, "topic", { pageSize: 100, fields: "nextPageToken,topic(topicId,name)" });

const WORK_FIELDS =
  "nextPageToken,courseWork(id,title,description,state,dueDate,dueTime,maxPoints,workType,topicId,alternateLink,creationTime,updateTime,materials,gradeCategory)";

export const listCourseWork = (token: string, courseId: string, pageSize = 100, maxPages = 2) =>
  paged<any>(token, `${BASE}/courses/${courseId}/courseWork`, "courseWork", { orderBy: "dueDate desc", pageSize, fields: WORK_FIELDS }, maxPages);

export const getCourseWork = (token: string, courseId: string, id: string) => gget<any>(token, `${BASE}/courses/${courseId}/courseWork/${id}`);

export const listMySubmissions = (token: string, courseId: string, courseWorkId = "-", maxPages = 3) =>
  paged<any>(
    token,
    `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions`,
    "studentSubmissions",
    {
      userId: "me",
      pageSize: 100,
      fields:
        "nextPageToken,studentSubmissions(id,courseWorkId,state,late,draftGrade,assignedGrade,alternateLink,updateTime,assignmentSubmission,shortAnswerSubmission,multipleChoiceSubmission,submissionHistory)",
    },
    maxPages,
  );

export const listAnnouncements = (token: string, courseId: string, pageSize = 30, maxPages = 2) =>
  paged<any>(
    token,
    `${BASE}/courses/${courseId}/announcements`,
    "announcements",
    { pageSize, fields: "nextPageToken,announcements(id,text,materials,updateTime,creationTime,alternateLink)" },
    maxPages,
  );

export const listMaterials = (token: string, courseId: string, pageSize = 50, maxPages = 2) =>
  paged<any>(
    token,
    `${BASE}/courses/${courseId}/courseWorkMaterials`,
    "courseWorkMaterial",
    { pageSize, fields: "nextPageToken,courseWorkMaterial(id,title,description,topicId,materials,updateTime,creationTime,alternateLink)" },
    maxPages,
  );

export const getRubrics = (token: string, courseId: string, courseWorkId: string) =>
  paged<any>(token, `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/rubrics`, "rubrics", {}, 1);

/** Reduce a Classroom `Material` to something compact and uniform. */
export function summarizeMaterial(m: any) {
  if (m.driveFile) {
    // Teacher materials nest the file (SharedDriveFile); student submission attachments do not.
    const f = m.driveFile.driveFile ?? m.driveFile;
    return { kind: "driveFile", id: f?.id, title: f?.title, url: f?.alternateLink, shareMode: m.driveFile.shareMode };
  }
  if (m.youTubeVideo) return { kind: "youtube", id: m.youTubeVideo.id, title: m.youTubeVideo.title, url: m.youTubeVideo.alternateLink };
  if (m.link) return { kind: "link", title: m.link.title, url: m.link.url };
  if (m.form) return { kind: "form", title: m.form.title, url: m.form.formUrl };
  return { kind: "unknown" };
}

type DueParts = { dueDate?: { year: number; month: number; day: number }; dueTime?: { hours?: number; minutes?: number } };

/** Classroom due dates are UTC. Returns an ISO string or null. */
export function dueIso(w: DueParts) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  const h = w.dueTime?.hours ?? 0;
  const mi = w.dueTime?.minutes ?? 0;
  // With a date but no time, Classroom treats the work as due at the end of that day.
  const [hh, mm] = w.dueTime ? [h, mi] : [23, 59];
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
}
