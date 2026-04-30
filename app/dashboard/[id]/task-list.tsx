"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  status: "not_started" | "in_progress" | "done";
  task_type: string | null;
};

export default function TaskList({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  async function updateTaskStatus(taskId: string, status: Task["status"]) {
    setLoadingTaskId(taskId);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        throw new Error("Failed to update task");
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Failed to update task");
    } finally {
      setLoadingTaskId(null);
    }
  }

  if (!tasks.length) {
    return <div>No tasks found</div>;
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div key={task.id} className="border p-3 rounded space-y-2">
          <div className="font-medium">{task.title}</div>

          <div className="text-sm text-gray-700">
            {task.description || "No description"}
          </div>

            <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <span>Type: {task.task_type || "unknown"}</span>
            <span>|</span>
            <span>Priority: {task.priority}</span>
            <span>|</span>
            <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                task.status === "done"
                    ? "bg-green-100 text-green-800"
                    : task.status === "in_progress"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-gray-100 text-gray-800"
                }`}
            >
                {task.status === "not_started"
                ? "Not started"
                : task.status === "in_progress"
                ? "In progress"
                : "Done"}
            </span>
            </div>

          <div className="flex gap-2 flex-wrap">
            <button
              className="px-3 py-1 border rounded"
              disabled={loadingTaskId === task.id}
              onClick={() => updateTaskStatus(task.id, "not_started")}
            >
              Not started
            </button>

            <button
              className="px-3 py-1 border rounded"
              disabled={loadingTaskId === task.id}
              onClick={() => updateTaskStatus(task.id, "in_progress")}
            >
              In progress
            </button>

            <button
              className="px-3 py-1 border rounded"
              disabled={loadingTaskId === task.id}
              onClick={() => updateTaskStatus(task.id, "done")}
            >
              Done
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}