export const TASK_COMPLETION_EVENT = "fourj:task-completed";

export type TaskCompletionNotice = {
    id: string;
    title: string;
    body: string;
    route: string;
};

export function notifyTaskCompletion(notice: TaskCompletionNotice) {
    window.dispatchEvent(new CustomEvent<TaskCompletionNotice>(TASK_COMPLETION_EVENT, { detail: notice }));
    void window.infiniteCanvasDesktop?.notifyTaskComplete({ title: notice.title, body: notice.body, route: notice.route });
}
