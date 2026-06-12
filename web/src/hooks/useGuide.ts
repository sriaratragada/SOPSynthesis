import type { Annotation, ClickPoint, CropRect, GuideOut, RedactionRect } from "@sops/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../api/client";

export type StepPatchBody = {
  instructionText?: string;
  calloutType?: "info" | "warning" | "caution";
  calloutText?: string;
  clearCallout: boolean;
  click?: ClickPoint;
  annotations?: Annotation[] | null;
  redactions?: RedactionRect[] | null;
  crop?: CropRect | null;
  flags?: { sensitive: string[] };
};

function fail(error: unknown): never {
  throw new Error(typeof error === "string" ? error : JSON.stringify(error));
}

export function useGuides() {
  return useQuery({
    queryKey: ["guides"],
    queryFn: async () => {
      const { data, error } = await client.GET("/api/guides");
      if (error) fail(error);
      return data!;
    },
  });
}

export function useGuide(guideId: string) {
  return useQuery({
    queryKey: ["guides", guideId],
    queryFn: async () => {
      const { data, error } = await client.GET("/api/guides/{guide_id}", {
        params: { path: { guide_id: guideId } },
      });
      if (error) fail(error);
      return data!;
    },
  });
}

export function usePatchGuide(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { title?: string; description?: string }) => {
      const { data, error } = await client.PATCH("/api/guides/{guide_id}", {
        params: { path: { guide_id: guideId } },
        body,
      });
      if (error) fail(error);
      return data!;
    },
    onSuccess: (guide) => {
      queryClient.setQueryData(["guides", guideId], guide);
      void queryClient.invalidateQueries({ queryKey: ["guides"], exact: true });
    },
  });
}

export function useDeleteGuide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (guideId: string) => {
      const { error } = await client.DELETE("/api/guides/{guide_id}", {
        params: { path: { guide_id: guideId } },
      });
      if (error) fail(error);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["guides"], exact: true }),
  });
}

function replaceStep(guide: GuideOut, step: GuideOut["steps"][number]): GuideOut {
  return { ...guide, steps: guide.steps.map((s) => (s.id === step.id ? step : s)) };
}

export function usePatchStep(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, body }: { stepId: string; body: StepPatchBody }) => {
      const { data, error } = await client.PATCH("/api/guides/{guide_id}/steps/{step_id}", {
        params: { path: { guide_id: guideId, step_id: stepId } },
        body,
      });
      if (error) fail(error);
      return data!;
    },
    onSuccess: (step) => {
      queryClient.setQueryData(["guides", guideId], (old: GuideOut | undefined) =>
        old ? replaceStep(old, step) : old,
      );
    },
  });
}

export function useRegenerateStep(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, force }: { stepId: string; force?: boolean }) => {
      const { data, error } = await client.POST(
        "/api/guides/{guide_id}/steps/{step_id}:regenerate",
        {
          params: { path: { guide_id: guideId, step_id: stepId } },
          body: { force: force ?? false },
        },
      );
      if (error) fail(error);
      return data!;
    },
    onSuccess: (step) => {
      queryClient.setQueryData(["guides", guideId], (old: GuideOut | undefined) =>
        old ? replaceStep(old, step) : old,
      );
    },
  });
}

export function useDeleteStep(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stepId: string) => {
      const { error } = await client.DELETE("/api/guides/{guide_id}/steps/{step_id}", {
        params: { path: { guide_id: guideId, step_id: stepId } },
      });
      if (error) fail(error);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["guides", guideId], exact: true }),
  });
}

export function useDuplicateStep(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stepId: string) => {
      const { data, error } = await client.POST(
        "/api/guides/{guide_id}/steps/{step_id}:duplicate",
        { params: { path: { guide_id: guideId, step_id: stepId } } },
      );
      if (error) fail(error);
      return data!;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["guides", guideId], exact: true }),
  });
}

export function useSplitStep(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stepId: string) => {
      const { data, error } = await client.POST("/api/guides/{guide_id}/steps/{step_id}:split", {
        params: { path: { guide_id: guideId, step_id: stepId } },
      });
      if (error) fail(error);
      return data!;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["guides", guideId], exact: true }),
  });
}

export function useMergeSteps(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stepIds: [string, string]) => {
      const { data, error } = await client.POST("/api/guides/{guide_id}/steps:merge", {
        params: { path: { guide_id: guideId } },
        body: { stepIds },
      });
      if (error) fail(error);
      return data!;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["guides", guideId], exact: true }),
  });
}

export function useReorderSteps(guideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stepIds: string[]) => {
      const { data, error } = await client.POST("/api/guides/{guide_id}/steps:reorder", {
        params: { path: { guide_id: guideId } },
        body: { stepIds },
      });
      if (error) fail(error);
      return data!;
    },
    // Optimistic: reorder the cached guide immediately, roll back on error.
    onMutate: async (stepIds) => {
      await queryClient.cancelQueries({ queryKey: ["guides", guideId], exact: true });
      const previous = queryClient.getQueryData<GuideOut>(["guides", guideId]);
      if (previous) {
        const byId = new Map(previous.steps.map((s) => [s.id, s]));
        queryClient.setQueryData(["guides", guideId], {
          ...previous,
          steps: stepIds
            .map((id) => byId.get(id))
            .filter((s): s is GuideOut["steps"][number] => s !== undefined)
            .map((s, position) => ({ ...s, position })),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["guides", guideId], context.previous);
    },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: ["guides", guideId], exact: true }),
  });
}
