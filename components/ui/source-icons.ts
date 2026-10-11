import { Building2, Car, Factory, Flame, HardHat } from "lucide-react";
import type { SourceCategory } from "@/types/air-quality";

export const SOURCE_ICON: Record<SourceCategory, typeof Car> = {
  traffic: Car,
  construction: HardHat,
  industrial: Factory,
  commercial: Building2,
  "waste-burning": Flame,
};
