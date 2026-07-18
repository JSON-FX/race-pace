import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const KEY = "selected_org_id";
export type Org = { id: string; name: string; slug: string; brand_color: string | null };

type OrgValue = {
  selectedOrgId: string | null;
  orgs: Org[];
  loading: boolean;
  refreshOrgs: () => Promise<void>;
  selectOrg: (id: string) => Promise<void>;
  clearOrg: () => Promise<void>;
};

const OrgContext = createContext<OrgValue | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      setSelectedOrgId(v);
      setLoading(false);
    });
  }, []);

  const refreshOrgs = async () => {
    const { data } = await supabase.from("organizations").select("id,name,slug,brand_color").order("name");
    setOrgs((data ?? []) as Org[]);
  };
  const selectOrg = async (id: string) => { await AsyncStorage.setItem(KEY, id); setSelectedOrgId(id); };
  const clearOrg = async () => { await AsyncStorage.removeItem(KEY); setSelectedOrgId(null); };

  return (
    <OrgContext.Provider value={{ selectedOrgId, orgs, loading, refreshOrgs, selectOrg, clearOrg }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
