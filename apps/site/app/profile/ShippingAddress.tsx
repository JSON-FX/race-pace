"use client";
import { FieldFrame } from "@race-pace/ui";
import { FormSelect } from "@race-pace/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePsgcRegions, usePsgcProvinces, usePsgcCities, usePsgcBarangays } from "@/lib/psgc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SELECT_CLASS = "w-full";

export function ShippingAddress({ values, onChange, issues = {} }: { values: Record<string, string>; issues?: Record<string, string>; onChange: (patch: Record<string, string>) => void }) {
  const [region, setRegion] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState("");
  const regions = usePsgcRegions();
  const provinces = usePsgcProvinces(region);
  const cities = usePsgcCities({ provinceCode: province, regionCode: region });
  const barangays = usePsgcBarangays(city);
  const code = values.shipping_barangay_code;
  useEffect(() => {
    if (!code) return;
    let active = true;
    const load = async () => {
      const db = createClient();
      const barangay = await db.from("psgc_barangays").select("city_code").eq("code", code).single();
      if (barangay.error) throw barangay.error;
      const result = await db.from("psgc_cities").select("region_code,province_code,code").eq("code", barangay.data.city_code).single();
      if (result.error) throw result.error;
      if (active) { setRegion(result.data.region_code); setProvince(result.data.province_code ?? ""); setCity(result.data.code); }
    };
    load().catch(() => { if (active) setError("Could not load the saved shipping location."); });
    return () => { active = false; };
  }, [code]);
  const selection = (id: string, label: string, value: string, rows: { code: string; name: string }[] | undefined, change: (value: string) => void, disabled = false) => <FieldFrame label={label} htmlFor={id} required error={id === "shipping-barangay" ? issues.shipping_barangay_code : undefined}>
    <FormSelect id={id} required className={SELECT_CLASS} value={value} disabled={disabled} onChange={(e) => change(e.target.value)}>
      <option value="">Select {label.toLowerCase()}</option>{(rows ?? []).map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}
    </FormSelect>
  </FieldFrame>;
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-muted-foreground">This address is required for your Passport and is ready when an event offers kit delivery. Saving it does not request delivery.</p>
    {(error || regions.error || provinces.error || cities.error || barangays.error) && <Alert variant="destructive" role="alert" className=""><AlertDescription>{error || "Could not load address choices. Please reload and try again."}</AlertDescription></Alert>}
    <div className="grid gap-5 sm:grid-cols-2">
      {selection("shipping-region", "Region", region, regions.data, (value) => { setRegion(value); setProvince(""); setCity(""); onChange({ shipping_barangay_code: "" }); })}
      {selection("shipping-province", "Province", province, provinces.data, (value) => { setProvince(value); setCity(""); onChange({ shipping_barangay_code: "" }); }, !region || !provinces.data?.length)}
      {selection("shipping-city", "City or municipality", city, cities.data, (value) => { setCity(value); onChange({ shipping_barangay_code: "" }); }, !region)}
      {selection("shipping-barangay", "Barangay", code ?? "", barangays.data, (value) => onChange({ shipping_barangay_code: value }), !city)}
      <FieldFrame label="ZIP code" htmlFor="shipping-zip" required error={issues.shipping_zip_code} className=""><Input id="shipping-zip" required inputMode="numeric" maxLength={4} value={values.shipping_zip_code ?? ""} onChange={(e) => onChange({ shipping_zip_code: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></FieldFrame>
      <FieldFrame label="House, unit or building and street" htmlFor="shipping-line" required error={issues.shipping_address_line} className="sm:col-span-2"><Input id="shipping-line" required maxLength={300} value={values.shipping_address_line ?? ""} onChange={(e) => onChange({ shipping_address_line: e.target.value })} /></FieldFrame>
    </div>
    <p className="text-xs text-muted-foreground">For a city without a province, select the city directly.</p>
    <Button type="button" variant="link" className="h-auto px-0" onClick={() => { setRegion(""); setProvince(""); setCity(""); setError(""); onChange({ shipping_barangay_code: "", shipping_zip_code: "", shipping_address_line: "" }); }}>Clear shipping address</Button>
  </div>;
}
