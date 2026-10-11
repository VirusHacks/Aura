"use client";

import type { ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { LANDMARK_BY_ID } from "@/data/landmarks";
import { useSimStore } from "@/store/simulation-store";
import { Aiims, BusTerminal, ConnaughtPlace, NehruPlace, NewDelhiStation, SchoolCampus } from "./landmarks/Civic";
import {
  ConstructionZones,
  Industry,
  Landfill,
  RiverBoats,
  SignatureBridge,
  TollPlaza,
} from "./landmarks/Infrastructure";
import { IndiaGate, JamaMasjid, LodhiTombs, LotusTemple, QutubMinar, RashtrapatiBhavan, RedFort } from "./landmarks/Monuments";

function Selectable({ id, children }: { id: string; children: ReactNode }) {
  const select = useSimStore((s) => s.select);
  const setHovered = useSimStore((s) => s.setHoveredLandmark);
  const landmark = LANDMARK_BY_ID[id];
  if (!landmark) return <>{children}</>;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    select({ kind: "landmark", id }, landmark.view);
  };
  return (
    <group
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(null);
        document.body.style.cursor = "";
      }}
    >
      {children}
    </group>
  );
}

export function Landmarks() {
  return (
    <group>
      <Selectable id="india-gate">
        <IndiaGate />
      </Selectable>
      <Selectable id="rashtrapati-bhavan">
        <RashtrapatiBhavan />
      </Selectable>
      <Selectable id="connaught-place">
        <ConnaughtPlace />
      </Selectable>
      <Selectable id="ndls">
        <NewDelhiStation />
      </Selectable>
      <Selectable id="red-fort">
        <RedFort />
      </Selectable>
      <Selectable id="jama-masjid">
        <JamaMasjid />
      </Selectable>
      <Selectable id="qutub-minar">
        <QutubMinar />
      </Selectable>
      <Selectable id="lotus-temple">
        <LotusTemple />
      </Selectable>
      <Selectable id="lodhi-garden">
        <LodhiTombs />
      </Selectable>
      <Selectable id="aiims">
        <Aiims />
      </Selectable>
      <Selectable id="school">
        <SchoolCampus />
      </Selectable>
      <Selectable id="nehru-place">
        <NehruPlace />
      </Selectable>
      <Selectable id="isbt-kashmere-gate">
        <BusTerminal which="kashmere-gate" />
      </Selectable>
      <Selectable id="anand-vihar-isbt">
        <BusTerminal which="anand-vihar" />
      </Selectable>
      <Selectable id="signature-bridge">
        <SignatureBridge />
      </Selectable>
      <Selectable id="mayapuri">
        <Industry />
      </Selectable>
      <Selectable id="outer-ring-works">
        <ConstructionZones />
      </Selectable>
      <Selectable id="ghazipur">
        <Landfill />
      </Selectable>
      <Selectable id="nh48">
        <TollPlaza />
      </Selectable>
      <RiverBoats />
    </group>
  );
}
