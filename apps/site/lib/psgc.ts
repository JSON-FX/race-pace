"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type PsgcRow = { code: string; name: string };
export type PsgcCity = { code: string; name: string; province_code: string | null; region_code: string };

export function usePsgcRegions() {
  return useQuery({ queryKey: ["psgc-regions"], queryFn: async (): Promise<PsgcRow[]> => {
    const supabase = createClient();
    const { data, error } = await supabase.from("psgc_regions").select("code,name").order("name");
    if (error) throw error; return (data ?? []) as PsgcRow[];
  } });
}

export function usePsgcProvinces(regionCode?: string) {
  return useQuery({ queryKey: ["psgc-provinces", regionCode], enabled: !!regionCode, queryFn: async (): Promise<PsgcRow[]> => {
    const supabase = createClient();
    const { data, error } = await supabase.from("psgc_provinces").select("code,name").eq("region_code", regionCode!).order("name");
    if (error) throw error; return (data ?? []) as PsgcRow[];
  } });
}

export function usePsgcCities({ provinceCode, regionCode }: { provinceCode?: string; regionCode?: string }) {
  return useQuery({ queryKey: ["psgc-cities", provinceCode, regionCode], enabled: !!(provinceCode || regionCode), queryFn: async (): Promise<PsgcRow[]> => {
    const supabase = createClient();
    let q = supabase.from("psgc_cities").select("code,name");
    if (provinceCode) q = q.eq("province_code", provinceCode);
    else if (regionCode) q = q.eq("region_code", regionCode).is("province_code", null);
    const { data, error } = await q.order("name");
    if (error) throw error; return (data ?? []) as PsgcRow[];
  } });
}

export function usePsgcCity(code?: string) {
  return useQuery({ queryKey: ["psgc-city", code], enabled: !!code, queryFn: async (): Promise<PsgcCity | null> => {
    const supabase = createClient();
    const { data, error } = await supabase.from("psgc_cities").select("code,name,province_code,region_code").eq("code", code!).maybeSingle();
    if (error) throw error; return (data ?? null) as PsgcCity | null;
  } });
}

export function usePsgcBarangays(cityCode: string) {
  return useQuery({ queryKey: ["psgc-barangays", cityCode], enabled: !!cityCode, queryFn: async (): Promise<PsgcRow[]> => {
    const { data, error } = await createClient().from("psgc_barangays").select("code,name").eq("city_code", cityCode).order("name").limit(1000);
    if (error) throw error;
    return (data ?? []) as PsgcRow[];
  } });
}
