"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { getAqiBand } from "@/lib/aqi";
import { viewForPoint } from "@/lib/camera-presets";
import { SOURCE_COLOR } from "@/lib/formatting";
import { mat } from "@/lib/materials";
import { ZONE_LABEL_Y as LABEL_Y, sourceEmitHeight } from "@/lib/scene-anchors";
import { useSimStore } from "@/store/simulation-store";
import type { SourceReading, ZoneReading } from "@/types/air-quality";

function Stems({ readings, selectedId }: { readings: ZoneReading[]; selectedId: string | null }) {
  return (
    <group>
      {readings.map((z) => {
        const color = getAqiBand(z.aqi).color;
        const sel = z.id === selectedId;
        return (
          <group key={z.id} position={[z.position[0], 0, z.position[1]]}>
            <mesh position={[0, LABEL_Y / 2, 0]} material={mat(color, { emissive: color })} raycast={() => null}>
              <cylinderGeometry args={[sel ? 0.07 : 0.045, sel ? 0.07 : 0.045, LABEL_Y, 6]} />
            </mesh>
            <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mat(color, { emissive: color })} raycast={() => null}>
              <ringGeometry args={[0.35, 0.65, 24]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function ZoneMarkers({ readings, selectedId, visible }: { readings: ZoneReading[]; selectedId: string | null; visible: boolean }) {
  // The DOM labels themselves live in <SceneLabels /> (dashboard layer).
  return (
    <group visible={visible}>
      <Stems readings={readings} selectedId={selectedId} />
    </group>
  );
}

function SourcePin({ source, selected, hidden }: { source: SourceReading; selected: boolean; hidden: boolean }) {
  const select = useSimStore((s) => s.select);
  const color = SOURCE_COLOR[source.category];
  const h = sourceEmitHeight(source) + 1.2;
  const pick = () => select({ kind: "source", id: source.id }, viewForPoint(source.position[0], source.position[1], 42));
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    pick();
  };
  return (
    <group position={[source.position[0], 0, source.position[1]]} visible={!hidden}>
      <mesh position={[0, h / 2, 0]} material={mat("#5b6470")} raycast={() => null}>
        <cylinderGeometry args={[0.035, 0.035, h, 5]} />
      </mesh>
      <mesh
        position={[0, h + 0.4, 0]}
        material={mat(color, { emissive: color, roughness: 0.4 })}
        onClick={hidden ? undefined : onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
        scale={selected ? 1.4 : 1}
      >
        <octahedronGeometry args={[0.5, 0]} />
      </mesh>
    </group>
  );
}

export function SourceMarkers({ sources, selectedId, visible }: { sources: SourceReading[]; selectedId: string | null; visible: boolean }) {
  return (
    <group>
      {sources.map((s) => (
        <SourcePin key={s.id} source={s} selected={s.id === selectedId} hidden={!visible} />
      ))}
    </group>
  );
}
