import { Progress } from "@base-ui/react/progress";
import {
  ArrowUpRight,
  Bike,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Gauge,
  MapPin,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const stats = [
  { label: "Distancia (mes)", value: "612", unit: "km", delta: "+8.4%" },
  { label: "Desnivel (mes)", value: "7,240", unit: "m D+", delta: "+12%" },
  { label: "Salidas (mes)", value: "14", unit: "", delta: "+2" },
  { label: "Velocidad media", value: "29.4", unit: "km/h", delta: "+0.6" },
];

type WearStatus = "good" | "warning" | "critical";

function wearStatus(pct: number): WearStatus {
  if (pct >= 80) return "critical";
  if (pct >= 50) return "warning";
  return "good";
}

const statusMeta: Record<
  WearStatus,
  { label: string; icon: typeof CircleCheck; className: string }
> = {
  good: { label: "Óptimo", icon: CircleCheck, className: "text-status-good" },
  warning: {
    label: "Vigilar",
    icon: TriangleAlert,
    className: "text-status-warning",
  },
  critical: {
    label: "Reemplazar",
    icon: CircleAlert,
    className: "text-status-critical",
  },
};

const components = [
  { label: "Cadena", pct: 82 },
  { label: "Cassette", pct: 54 },
  { label: "Neumático trasero", pct: 61 },
  { label: "Pastillas de freno", pct: 24 },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:px-8 sm:py-14">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          <Bike className="size-3.5" />
          The Virtual Mechanic
        </div>
        <Badge variant="outline" className="gap-1.5 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-status-good" />
          Sincronizado hace 2 h
        </Badge>
      </header>

      <section className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Scott Addict RC 10 · 2023</p>
        <div className="flex flex-wrap items-end gap-3">
          <span className="text-5xl font-semibold tracking-tight sm:text-6xl">
            8,412
          </span>
          <span className="pb-1 text-lg text-muted-foreground sm:pb-2">
            km acumulados
          </span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardContent className="flex flex-col gap-1">
              <CardDescription>{stat.label}</CardDescription>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl font-semibold tracking-tight">
                  {stat.value}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {stat.unit}
                  </span>
                </span>
                <span className="flex items-center gap-0.5 text-xs text-status-good">
                  <ArrowUpRight className="size-3" />
                  {stat.delta}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 md:grid-cols-5">
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Estado de componentes</CardTitle>
            <CardDescription>Desgaste estimado desde la última revisión</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {components.map((component) => {
              const status = wearStatus(component.pct);
              const meta = statusMeta[status];
              const Icon = meta.icon;
              return (
                <div key={component.label} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{component.label}</span>
                    <span
                      className={cn(
                        "flex items-center gap-1 text-xs",
                        meta.className
                      )}
                    >
                      <Icon className="size-3.5" />
                      {meta.label}
                    </span>
                  </div>
                  <Progress.Root value={component.pct}>
                    <ProgressTrack>
                      <ProgressIndicator
                        className={cn(
                          status === "good" && "bg-status-good",
                          status === "warning" && "bg-status-warning",
                          status === "critical" && "bg-status-critical"
                        )}
                      />
                    </ProgressTrack>
                  </Progress.Root>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4 text-brand" />
                Próximo mantenimiento
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <p className="text-sm">Cambio de cadena</p>
              <p className="text-sm text-muted-foreground">
                En 180 km o 12 días, lo que ocurra antes
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Última salida</CardTitle>
              <CardDescription>Ayer</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="size-3.5 text-muted-foreground" />
                Puerto de la Morcuera
              </div>
              <Separator />
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="flex flex-col">
                  <span className="text-lg font-semibold tabular-nums">84.2</span>
                  <span className="text-xs text-muted-foreground">km</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-lg font-semibold tabular-nums">1,240</span>
                  <span className="text-xs text-muted-foreground">m D+</span>
                </div>
                <div className="flex flex-col">
                  <span className="flex items-center justify-center gap-1 text-lg font-semibold tabular-nums">
                    <Gauge className="size-3.5 text-muted-foreground" />
                    27.8
                  </span>
                  <span className="text-xs text-muted-foreground">km/h</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
