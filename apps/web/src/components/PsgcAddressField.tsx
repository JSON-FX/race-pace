import { useEffect, useRef, useState } from "react";
import type { PsgcAddress } from "@race-pace/shared";
import { usePsgcRegions, usePsgcProvinces, usePsgcCities, usePsgcCity } from "../lib/psgc";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const fieldLabel = "mb-1.5 block text-[11px] font-semibold tracking-wide text-muted-foreground";

/** Cascading Region → Province → City selects. Emits a full PsgcAddress on each
 *  change (partial until a city is chosen). NCR-style regions with no provinces
 *  skip the Province step and filter cities by region. */
export function PsgcAddressField({ value, onChange }: { value: PsgcAddress | null; onChange: (a: PsgcAddress) => void }) {
  const [regionCode, setRegionCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const seeded = useRef(false);

  const regions = usePsgcRegions();
  const provinces = usePsgcProvinces(regionCode || undefined);
  const noProvinces = !!regionCode && provinces.isSuccess && (provinces.data?.length ?? 0) === 0;
  const cities = usePsgcCities({ provinceCode: provinceCode || undefined, regionCode: noProvinces ? regionCode : undefined });
  const seedCity = usePsgcCity(value?.city_psgc_code || undefined);

  // Edit-seed: recover region/province codes from the stored city code, once.
  useEffect(() => {
    if (!seeded.current && value?.city_psgc_code && seedCity.data) {
      seeded.current = true;
      setRegionCode(seedCity.data.region_code);
      setProvinceCode(seedCity.data.province_code ?? "");
    }
  }, [value?.city_psgc_code, seedCity.data]);

  const nameOf = (rows: { code: string; name: string }[] | undefined, code: string) => (rows ?? []).find((r) => r.code === code)?.name ?? null;
  const regionName = nameOf(regions.data, regionCode) ?? value?.region_name ?? null;
  const provinceName = nameOf(provinces.data, provinceCode) ?? value?.province_name ?? null;

  function pickRegion(code: string) {
    setRegionCode(code); setProvinceCode("");
    onChange({ city_psgc_code: null, city_name: null, province_name: null, region_name: code ? nameOf(regions.data, code) : null });
  }
  function pickProvince(code: string) {
    setProvinceCode(code);
    onChange({ city_psgc_code: null, city_name: null, province_name: code ? nameOf(provinces.data, code) : null, region_name: regionName });
  }
  function pickCity(code: string) {
    onChange({ city_psgc_code: code || null, city_name: code ? nameOf(cities.data, code) : null, province_name: provinceName, region_name: regionName });
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <Label className={fieldLabel}>REGION</Label>
        <Select value={regionCode || undefined} onValueChange={pickRegion}>
          <SelectTrigger aria-label="Region" className="w-full">
            <SelectValue placeholder="— Select —" />
          </SelectTrigger>
          <SelectContent>
            {(regions.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className={fieldLabel}>PROVINCE</Label>
        <Select value={provinceCode || undefined} onValueChange={pickProvince} disabled={!regionCode || noProvinces}>
          <SelectTrigger aria-label="Province" className="w-full">
            <SelectValue placeholder={noProvinces ? "— None —" : "— Select —"} />
          </SelectTrigger>
          <SelectContent>
            {(provinces.data ?? []).map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className={fieldLabel}>CITY / MUNICIPALITY</Label>
        <Select value={value?.city_psgc_code ?? undefined} onValueChange={pickCity} disabled={!(provinceCode || noProvinces)}>
          <SelectTrigger aria-label="City" className="w-full">
            <SelectValue placeholder="— Select —" />
          </SelectTrigger>
          <SelectContent>
            {(cities.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
