import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, client } from "../api/client";

export const logoUrl = () => `${API_BASE}/api/settings/logo`;

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await client.GET("/api/settings");
      if (error) throw new Error(JSON.stringify(error));
      return data!;
    },
  });
}

export function usePatchSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { markerColor?: string }) => {
      const { data, error } = await client.PATCH("/api/settings", { body });
      if (error) throw new Error(JSON.stringify(error));
      return data!;
    },
    onSuccess: (settings) => queryClient.setQueryData(["settings"], settings),
  });
}

export function useUploadLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("logo", file);
      const res = await fetch(`${API_BASE}/api/settings/logo`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Logo upload failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (settings) => queryClient.setQueryData(["settings"], settings),
  });
}

export function useDeleteLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/api/settings/logo");
      if (error) throw new Error(JSON.stringify(error));
      return data!;
    },
    onSuccess: (settings) => queryClient.setQueryData(["settings"], settings),
  });
}
