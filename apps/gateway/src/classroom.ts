import { gget } from "./google.js";

const BASE = "https://classroom.googleapis.com/v1";

export async function listCourses(token: string, includeArchived = false) {
  const data = await gget<{ courses?: any[] }>(token, `${BASE}/courses`, {
    studentId: "me",
    courseStates: includeArchived ? undefined : "ACTIVE",
    pageSize: 50,
    fields: "courses(id,name,section,descriptionHeading,room,courseState,alternateLink,calendarId)",
  });
  return data.courses ?? [];
}

export async function listTopics(token: string, courseId: string) {
  const data = await gget<{ topic?: any[] }>(token, `${BASE}/courses/${courseId}/topics`, {
    pageSize: 100,
    fields: "topic(topicId,name)",
  });
  return data.topic ?? [];
}

const WORK_FIELDS =
  "courseWork(id,title,description,state,dueDate,dueTime,maxPoints,workType,topicId,alternateLink,updateTime,materials)";

export async function listCourseWork(token: string, courseId: string, pageSize = 30) {
  const data = await gget<{ courseWork?: any[] }>(token, `${BASE}/courses/${courseId}/courseWork`, {
    orderBy: "dueDate desc",
    pageSize,
    fields: WORK_FIELDS,
  });
  return data.courseWork ?? [];
}

export async function getCourseWork(token: string, courseId: string, id: string) {
  return gget<any>(token, `${BASE}/courses/${courseId}/courseWork/${id}`);
}

export async function listMySubmissions(token: string, courseId: string, courseWorkId = "-") {
  const data = await gget<{ studentSubmissions?: any[] }>(
    token,
    `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions`,
    {
      userId: "me",
      pageSize: 100,
      fields:
        "studentSubmissions(id,courseWorkId,state,late,draftGrade,assignedGrade,alternateLink,assignmentSubmission,shortAnswerSubmission,multipleChoiceSubmission,submissionHistory)",
    },
  );
  return data.studentSubmissions ?? [];
}

export async function listAnnouncements(token: string, courseId: string, pageSize = 20) {
  const data = await gget<{ announcements?: any[] }>(token, `${BASE}/courses/${courseId}/announcements`, {
    pageSize,
    fields: "announcements(id,text,materials,updateTime,creationTime,alternateLink)",
  });
  return data.announcements ?? [];
}

export async function listMaterials(token: string, courseId: string, pageSize = 30) {
  const data = await gget<{ courseWorkMaterial?: any[] }>(token, `${BASE}/courses/${courseId}/courseWorkMaterials`, {
    pageSize,
    fields: "courseWorkMaterial(id,title,description,topicId,materials,updateTime,alternateLink)",
  });
  return data.courseWorkMaterial ?? [];
}

export async function getRubrics(token: string, courseId: string, courseWorkId: string) {
  const data = await gget<{ rubrics?: any[] }>(token, `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/rubrics`);
  return data.rubrics ?? [];
}

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

export function dueIso(w: { dueDate?: { year: number; month: number; day: number }; dueTime?: { hours?: number; minutes?: number } }) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  const h = w.dueTime?.hours ?? 23;
  const mi = w.dueTime?.minutes ?? 59;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}Z`;
}
