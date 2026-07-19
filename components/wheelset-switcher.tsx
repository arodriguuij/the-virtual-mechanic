"use client";

import { Check } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Wheelset = {
  id: string;
  name: string;
  is_active: boolean;
};

export function WheelsetSwitcher({
  bikeId,
  wheelsets,
}: {
  bikeId: string;
  wheelsets: Wheelset[];
}) {
  const active = wheelsets.find((w) => w.is_active);

  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-2 border border-neutral-300 px-3 py-1.5 text-[11px] font-medium tracking-widest text-neutral-700 uppercase transition-colors hover:border-neutral-900 hover:text-neutral-900">
        🛞 {active?.name ?? "Sin kit de ruedas"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kits de ruedas</DialogTitle>
          <DialogDescription>
            Solo las piezas del kit activo acumulan desgaste en tus próximas rutas — los
            demás kits quedan congelados hasta que los vuelvas a montar.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2">
          {wheelsets.map((wheelset) => (
            <li
              key={wheelset.id}
              className={cn(
                "flex items-center justify-between gap-3 border px-3 py-2.5 text-sm",
                wheelset.is_active ? "border-neutral-900 bg-neutral-900/5" : "border-neutral-200"
              )}
            >
              <span className="flex items-center gap-2 text-neutral-900">
                {wheelset.is_active && <Check className="size-3.5" />}
                {wheelset.name}
              </span>
              {!wheelset.is_active && (
                <form action="/api/wheelsets/activate" method="POST">
                  <input type="hidden" name="wheelsetId" value={wheelset.id} />
                  <button
                    type="submit"
                    className="text-[10px] font-medium tracking-widest text-neutral-500 uppercase transition-colors hover:text-neutral-900"
                  >
                    Activar
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>

        <form
          action="/api/wheelsets/create"
          method="POST"
          className="flex items-center gap-2 border-t border-neutral-200 pt-4"
        >
          <input type="hidden" name="bikeId" value={bikeId} />
          <input
            name="name"
            type="text"
            required
            placeholder="Ej. Ruedas de carbono verano"
            className="flex-1 border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          />
          <button
            type="submit"
            className="inline-flex shrink-0 items-center justify-center border border-neutral-900 bg-neutral-900 px-4 py-2 text-[11px] font-medium tracking-widest text-background uppercase transition-colors hover:bg-neutral-700"
          >
            Añadir kit
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
