import { useState } from "react";
import { View } from "react-native";
import { usePsgcCities, usePsgcProvinces, usePsgcRegions } from "@/lib/psgc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RegionFilterValue } from "@/lib/marketplaceFilters";

type Option = { value: string; label: string } | undefined;

export function RegionFilterPicker({ onChange }: { onChange: (v: RegionFilterValue) => void }) {
  const [regionCode, setRegionCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");

  const regions = usePsgcRegions();
  const provinces = usePsgcProvinces(regionCode || undefined);
  const provincesLoading = !!regionCode && !provinces.isSuccess;
  const noProvinces = !!regionCode && provinces.isSuccess && (provinces.data?.length ?? 0) === 0;
  const cities = usePsgcCities({ provinceCode: provinceCode || undefined, regionCode: noProvinces ? regionCode : undefined });
  const citiesLoading = (!!provinceCode || noProvinces) && !cities.isSuccess;

  const regionName = (regions.data ?? []).find((r) => r.code === regionCode)?.name ?? null;
  const provinceName = (provinces.data ?? []).find((p) => p.code === provinceCode)?.name ?? null;

  function pickRegion(option: Option) {
    if (!option) return;
    setRegionCode(option.value);
    setProvinceCode("");
    onChange({ region_name: option.label });
  }
  function pickProvince(option: Option) {
    if (!option || !regionName) return;
    setProvinceCode(option.value);
    onChange({ region_name: regionName, province_name: option.label });
  }
  function pickCity(option: Option) {
    if (!option || !regionName) return;
    onChange({ region_name: regionName, province_name: provinceName ?? undefined, city_name: option.label });
  }

  const regionValue: Option = regionCode ? { value: regionCode, label: regionName ?? "" } : undefined;
  const provinceValue: Option = provinceCode ? { value: provinceCode, label: provinceName ?? "" } : undefined;
  const cityEnabled = !!provinceCode || noProvinces;

  return (
    <View className="gap-2">
      <Select value={regionValue} onValueChange={pickRegion}>
        <SelectTrigger accessibilityLabel="Region"><SelectValue placeholder="Select region" /></SelectTrigger>
        <SelectContent>
          {(regions.data ?? []).map((r) => <SelectItem key={r.code} value={r.code} label={r.name} />)}
        </SelectContent>
      </Select>

      {regionCode && !noProvinces ? (
        <Select key={regionCode} value={provinceValue} onValueChange={pickProvince}>
          <SelectTrigger accessibilityLabel="Province" disabled={provincesLoading}>
            <SelectValue placeholder={provincesLoading ? "Loading…" : "Select province"} />
          </SelectTrigger>
          <SelectContent>
            {(provinces.data ?? []).map((p) => <SelectItem key={p.code} value={p.code} label={p.name} />)}
          </SelectContent>
        </Select>
      ) : null}

      {regionCode ? (
        <Select key={`${regionCode}:${provinceCode}`} onValueChange={pickCity}>
          <SelectTrigger accessibilityLabel="City" disabled={!cityEnabled || citiesLoading}>
            <SelectValue placeholder={citiesLoading ? "Loading…" : "Select city (optional)"} />
          </SelectTrigger>
          <SelectContent>
            {(cities.data ?? []).map((c) => <SelectItem key={c.code} value={c.code} label={c.name} />)}
          </SelectContent>
        </Select>
      ) : null}
    </View>
  );
}
