"use client";

import { useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Method = "new" | "km" | "gauge";

const radioLabelClass = "flex items-center gap-2 text-sm text-neutral-900";
const radioInputClass = "size-4 accent-neutral-900";

export function CalibrationDialog({
  componentId,
  componentType,
  componentName,
}: {
  componentId: string;
  componentType: string;
  componentName: string;
}) {
  const [method, setMethod] = useState<Method>("new");
  const [gauge, setGauge] = useState("0.5");
  const isChain = componentType === "chain";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setMethod("new");
          setGauge("0.5");
        }
      }}
    >
      <DialogTrigger className="text-[11px] font-medium tracking-widest text-neutral-500 uppercase transition-colors hover:text-neutral-900">
        Calibrar pieza
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Calibrar {componentName}</DialogTitle>
          <DialogDescription>
            Dinos el estado real de esta pieza para ajustar el Gemelo Digital.
          </DialogDescription>
        </DialogHeader>

        <form
          action="/api/components/calibrate"
          method="POST"
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="componentId" value={componentId} />

          <fieldset className="flex flex-col gap-2.5">
            <label className={radioLabelClass}>
              <input
                type="radio"
                name="method"
                value="new"
                checked={method === "new"}
                onChange={() => setMethod("new")}
                className={radioInputClass}
              />
              Es una pieza nueva (0 km)
            </label>
            <label className={radioLabelClass}>
              <input
                type="radio"
                name="method"
                value="km"
                checked={method === "km"}
                onChange={() => setMethod("km")}
                className={radioInputClass}
              />
              Introducir kilómetros estimados
            </label>
            {isChain && (
              <label className={radioLabelClass}>
                <input
                  type="radio"
                  name="method"
                  value="gauge"
                  checked={method === "gauge"}
                  onChange={() => setMethod("gauge")}
                  className={radioInputClass}
                />
                Tengo un medidor de desgaste físico
              </label>
            )}
          </fieldset>

          {method === "km" && (
            <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-4">
              <label
                htmlFor="km"
                className="text-[10px] font-medium tracking-widest text-neutral-600 uppercase"
              >
                Kilómetros ya recorridos con esta pieza
              </label>
              <input
                id="km"
                name="km"
                type="number"
                min={0}
                step={1}
                required
                placeholder="Ej. 1200"
                className="border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
              />
              <p className="text-xs text-neutral-500">
                Calculamos el % de desgaste de forma lineal sobre el límite estimado de la
                pieza.
              </p>
            </div>
          )}

          {method === "gauge" && isChain && (
            <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
              <label className={radioLabelClass}>
                <input
                  type="radio"
                  name="gauge"
                  value="0.5"
                  checked={gauge === "0.5"}
                  onChange={() => setGauge("0.5")}
                  className={radioInputClass}
                />
                El medidor entra hasta 0.5% — fija el desgaste al 50%
              </label>
              <label className={radioLabelClass}>
                <input
                  type="radio"
                  name="gauge"
                  value="0.75"
                  checked={gauge === "0.75"}
                  onChange={() => setGauge("0.75")}
                  className={radioInputClass}
                />
                El medidor entra hasta 0.75% — fija el desgaste al 75% (zona crítica)
              </label>
              <label className={radioLabelClass}>
                <input
                  type="radio"
                  name="gauge"
                  value="1.0"
                  checked={gauge === "1.0"}
                  onChange={() => setGauge("1.0")}
                  className={radioInputClass}
                />
                El medidor entra hasta 1.0% — cadena totalmente estirada
              </label>

              {gauge === "1.0" && (
                <p className="border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
                  ¡Peligro estructural! Tu cadena está destrozando el cassette y los platos
                  en cada pedalada. Sustitución inmediata requerida.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose className="inline-flex items-center justify-center border border-neutral-300 px-4 py-2 text-[11px] font-medium tracking-widest text-neutral-700 uppercase transition-colors hover:bg-neutral-100">
              Cancelar
            </DialogClose>
            <button
              type="submit"
              className="inline-flex items-center justify-center border border-neutral-900 bg-neutral-900 px-4 py-2 text-[11px] font-medium tracking-widest text-background uppercase transition-colors hover:bg-neutral-700"
            >
              Guardar calibración
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
