import React from 'react';
import { TripTicket, Material } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_WEBSITE } from '../constants';
import { BrandLogo } from './BrandLogo';
import { cn } from '../lib/utils';

interface TripTicketDocumentProps {
  ticket: TripTicket;
  materials: Material[];
  className?: string;
}

export const TripTicketDocument: React.FC<TripTicketDocumentProps> = ({
  ticket,
  materials,
  className = ""
}) => {
  const formattedDate = ticket.timestamp
    ? new Date(ticket.timestamp).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : new Date().toLocaleString();

  const hasAnyGrossTare = ticket.materials.some(
    (m) => (m.grossWeight !== undefined && m.grossWeight > 0) || (m.tareWeight !== undefined && m.tareWeight > 0)
  );

  return (
    <div
      className={cn(
        "bg-white px-5 py-3.5 font-sans text-slate-900 bol-container relative flex flex-col min-h-0 w-full max-w-[1000px] print:max-w-none print:p-0 print:m-0 mx-auto",
        className
      )}
    >
      {/* Screen Accent Border */}
      <div className="absolute top-0 left-0 w-full h-1 bg-slate-900 no-print" />

      {/* Header Section */}
      <div className="flex justify-between items-start mb-2 text-left">
        <div className="space-y-0.5 max-w-lg">
          <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 leading-tight">
            {COMPANY_NAME}
          </h1>
          <p className="text-[10px] text-slate-500 font-medium tracking-wide">
            {COMPANY_WEBSITE} • {COMPANY_EMAIL}
          </p>
          <p className="text-[10px] text-slate-600 font-semibold">
            {COMPANY_ADDRESS} • Tel: {COMPANY_PHONE}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <div className="h-10 w-auto flex items-center justify-end">
            <BrandLogo className="h-full w-auto object-contain grayscale opacity-80" grayscale />
          </div>
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 mt-0.5">
            Bill of Lading / Dispatch Ticket
          </span>
        </div>
      </div>

      {/* Document Meta Banner */}
      <div className="border-y border-slate-200 py-1 mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-600 bg-slate-50/70 print:bg-transparent px-2">
        <div className="flex items-center gap-1.5">
          <span>Ticket ID:</span>
          <span className="font-black text-slate-900 font-mono">{ticket.id.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Dispatch Date:</span>
          <span className="font-black text-slate-900">{formattedDate}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Status:</span>
          <span className="font-black uppercase text-slate-900">{ticket.status || 'In-Transit'}</span>
        </div>
      </div>

      {/* Logistics & Dispatch Card Grid */}
      <div className="grid grid-cols-2 gap-3 mb-2.5 p-2.5 bg-slate-50/90 rounded-lg border border-slate-200 text-left avoid-break print:bg-transparent print:p-2 print:border-slate-300">
        {/* Left Column: Destination & Shipper */}
        <div className="space-y-1.5">
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Destination / Ship To</p>
            <p className="text-sm font-black text-slate-900 uppercase tracking-tight leading-tight mt-0.5">
              {ticket.destination || 'N/A'}
            </p>
            {ticket.buyerAddress && (
              <p className="text-[10px] text-slate-600 mt-0.5 whitespace-pre-line leading-tight">{ticket.buyerAddress}</p>
            )}
            {ticket.buyerPhone && (
              <p className="text-[10px] text-slate-500 mt-0.5">Phone: {ticket.buyerPhone}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/80">
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Carrier</p>
              <p className="text-[11px] font-bold text-slate-900 uppercase truncate">
                {ticket.carrier || 'Internal Fleet'}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Driver</p>
              <p className="text-[11px] font-bold text-slate-900 uppercase truncate">
                {ticket.driver || 'N/A'}
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Transport Identifiers */}
        <div className="grid grid-cols-2 gap-1.5 content-start">
          <div className="p-1.5 bg-white rounded border border-slate-200/90 print:p-1 print:border-slate-300">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">BOL Number</p>
            <p className="text-[11px] font-black text-slate-900 font-mono truncate">{ticket.bolNumber || 'N/A'}</p>
          </div>
          <div className="p-1.5 bg-white rounded border border-slate-200/90 print:p-1 print:border-slate-300">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Truck / Vehicle ID</p>
            <p className="text-[11px] font-black text-slate-900 uppercase font-mono truncate">{ticket.vehicle || 'N/A'}</p>
          </div>
          <div className="p-1.5 bg-white rounded border border-slate-200/90 print:p-1 print:border-slate-300">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Trailer #</p>
            <p className="text-[11px] font-bold text-slate-900 uppercase truncate">{ticket.trailerNumber || 'N/A'}</p>
          </div>
          <div className="p-1.5 bg-white rounded border border-slate-200/90 print:p-1 print:border-slate-300">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Seal #</p>
            <p className="text-[11px] font-bold text-slate-900 uppercase truncate">{ticket.sealNumber || 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Material Manifest Table */}
      <div className="flex-1 mb-2.5">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-900 bg-slate-50/50 print:bg-transparent">
              <th className="py-1 px-1.5 text-left text-[9px] font-black uppercase tracking-wider text-slate-600 w-7">
                #
              </th>
              <th className="py-1 px-1.5 text-left text-[9px] font-black uppercase tracking-wider text-slate-600">
                Material Description
              </th>
              {hasAnyGrossTare && (
                <th className="py-1 px-1.5 text-right text-[9px] font-black uppercase tracking-wider text-slate-600 w-32">
                  Gross / Tare (lb)
                </th>
              )}
              <th className="py-1 px-1.5 text-right text-[9px] font-black uppercase tracking-wider text-slate-600 w-28">
                Net Weight
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 font-sans">
            {ticket.materials.map((item, idx) => {
              const material = materials.find((m) => m.id === item.materialId);
              const hasRowGrossTare =
                (item.grossWeight !== undefined && item.grossWeight > 0) ||
                (item.tareWeight !== undefined && item.tareWeight > 0);

              return (
                <tr key={idx} className="avoid-break hover:bg-slate-50/50">
                  <td className="py-1 px-1.5 text-left text-[11px] font-bold text-slate-400 font-mono">
                    {idx + 1}
                  </td>
                  <td className="py-1 px-1.5 text-left">
                    <div className="space-y-0.2">
                      <p className="text-[11px] font-bold text-slate-900 uppercase tracking-tight leading-snug">
                        {item.boxNumber ? `${item.boxNumber}: ` : ''}
                        {item.customName || material?.name || 'Unknown Material'}
                      </p>
                      <div className="flex items-center gap-2 text-[9px] text-slate-500 font-medium leading-none">
                        <span>Code: {material?.code || '-'}</span>
                        {item.slotIndex !== undefined && (
                          <span>• Slot {item.slotIndex + 1}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  {hasAnyGrossTare && (
                    <td className="py-1 px-1.5 text-right text-[10px] text-slate-600 font-mono leading-none">
                      {hasRowGrossTare ? (
                        <span>
                          G: {(item.grossWeight || 0).toLocaleString()} | T: {(item.tareWeight || 0).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  )}
                  <td className="py-1 px-1.5 text-right text-[11px] font-black text-slate-900 font-mono leading-none">
                    {item.weight.toLocaleString()} {material?.unit || 'lb'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Summary, Notes, and Signatures */}
      <div className="mt-auto pt-2.5 border-t-2 border-slate-900 flex justify-between items-start text-left avoid-break gap-5">
        <div className="flex-1 space-y-2">
          {ticket.notes && (
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-[10px] text-slate-600 italic leading-snug">
              <span className="font-bold text-slate-800 not-italic uppercase text-[8px] tracking-wider block mb-0.5">
                Special Instructions / Notes:
              </span>
              {ticket.notes}
            </div>
          )}

          {/* Dual Compact Signature Lines */}
          <div className="grid grid-cols-2 gap-4 pt-1.5">
            <div className="space-y-1">
              <div className="w-full border-b border-slate-400 h-5"></div>
              <p className="text-[8px] font-black uppercase tracking-wider text-slate-500">
                Shipper / Yard Authorized Signature
              </p>
            </div>
            <div className="space-y-1">
              <div className="w-full border-b border-slate-400 h-5"></div>
              <p className="text-[8px] font-black uppercase tracking-wider text-slate-500">
                Driver / Carrier Acceptance Signature
              </p>
            </div>
          </div>
        </div>

        <div className="w-72 space-y-1.5 text-right flex flex-col items-end shrink-0">
          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full text-right print:bg-transparent print:border-slate-300 space-y-2">
            {/* Net Material Weight */}
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">NET MATERIAL WEIGHT</p>
              <p className="text-lg font-black text-slate-900 font-mono mt-0.5 leading-none">
                {(ticket.totalWeight || 0).toLocaleString()} <span className="text-[11px] text-slate-500 font-sans">lb</span>
              </p>
              <p className="text-[8px] font-bold text-slate-400 mt-0.5">
                {ticket.materials.length} Material Line Item{ticket.materials.length === 1 ? '' : 's'}
              </p>
            </div>

            {/* Total Load Weight (Gross Write-in Box for Pallets & Boxes) */}
            <div className="pt-2 border-t border-dashed border-slate-300 text-left">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-900">TOTAL LOAD WEIGHT</p>
                <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">(Manual Gross Wt)</span>
              </div>
              <div className="mt-1 h-8 border-2 border-slate-900 rounded-lg bg-white flex items-center justify-between px-3 print:bg-transparent">
                <span className="text-[9px] font-sans font-medium text-slate-300 select-none italic no-print">Enter Gross Scale Wt...</span>
                <span className="text-[11px] font-black text-slate-900 font-mono ml-auto">LBS</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Security & System Footer */}
      <div className="mt-2.5 pt-1.5 border-t border-slate-200 flex justify-between items-center text-[8px] font-bold uppercase tracking-wider text-slate-400 opacity-60 avoid-break">
        <div>
          {COMPANY_NAME} • LOGISTICS DISPATCH SYSTEM
        </div>
        <div>
          HEX-TRIP-{ticket.id.toUpperCase()}
        </div>
      </div>
    </div>
  );
};

export default TripTicketDocument;
