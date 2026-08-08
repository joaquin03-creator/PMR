import React from 'react';
import { BuyTicket, Material } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_WEBSITE } from '../constants';
import { useSettings } from '../context/SettingsContext';

interface BuyTicketPrintProps {
  ticket: BuyTicket;
  customerName: string;
  materials: Material[];
  format?: 'letter' | 'thermal';
  thermalWidth?: '80mm' | '58mm';
  thermalFont?: 'mono' | 'sans';
  thermalShowBarcode?: boolean;
  thermalPrintDensity?: 'compact' | 'normal';
}

// Simple and highly effective simulated barcode component for Epson Thermal Printer
const BarcodeSim: React.FC<{ value: string }> = ({ value }) => {
  if (!value) return null;
  const cleanVal = value.toUpperCase().slice(-8);
  const bars: boolean[] = [];
  bars.push(...Array(10).fill(false));
  bars.push(true, false, true);
  for (let i = 0; i < cleanVal.length; i++) {
    const charCode = cleanVal.charCodeAt(i);
    for (let bit = 0; bit < 7; bit++) {
      bars.push(((charCode >> bit) & 1) === 1);
      bars.push(false);
    }
  }
  bars.push(true, false, true);
  bars.push(...Array(10).fill(false));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '12px', marginBottom: '8px' }}>
      <div style={{ display: 'flex', height: '36px', width: '100%', maxWidth: '180px', backgroundColor: '#fff', padding: '2px 4px', boxSizing: 'border-box' }}>
        {bars.map((isBar, idx) => (
          <div
            key={idx}
            style={{
              flex: 1,
              height: '100%',
              backgroundColor: isBar ? '#000000' : 'transparent',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: '9px', fontFamily: 'monospace', letterSpacing: '3px', marginTop: '1px', fontWeight: 'bold' }}>
        *{cleanVal}*
      </span>
    </div>
  );
};

export const BuyTicketPrint: React.FC<BuyTicketPrintProps> = ({
  ticket,
  customerName,
  materials,
  format,
  thermalWidth,
  thermalFont,
  thermalShowBarcode,
  thermalPrintDensity,
}) => {
  const { settings } = useSettings();
  
  const finalFormat = format || settings.receiptFormat;
  const isThermal = finalFormat === 'thermal';
  const activeWidth = isThermal ? (thermalWidth || settings.thermalWidth || '80mm') : '800px';
  const activeFont = isThermal ? (thermalFont || settings.thermalFont || 'mono') : 'sans';
  const density = isThermal ? (thermalPrintDensity || settings.thermalPrintDensity || 'normal') : 'normal';
  const isCompact = isThermal && density === 'compact';
  const shouldShowBarcode = isThermal ? (thermalShowBarcode !== undefined ? thermalShowBarcode : (settings.thermalShowBarcode ?? true)) : false;

  const ticketMaterials = ticket.materials || [];
  
  // Calculate totals
  const totalNetWeight = ticketMaterials.reduce(
    (sum, item) => sum + ((item.netWeight || 0) - (item.deductionWeight || 0)), 
    0
  );

  const calculatedTotalAmount = ticketMaterials.reduce((sum, item) => {
    const paidWeight = Math.max(0, (item.netWeight || 0) - (item.deductionWeight || 0));
    const itemTotal = (item.totalAmount !== undefined && item.totalAmount !== null && item.totalAmount > 0)
      ? item.totalAmount
      : (paidWeight * (item.pricePerUnit || 0));
    return sum + itemTotal;
  }, 0);

  const finalTotalAmount = (ticket.totalAmount !== undefined && ticket.totalAmount > 0)
    ? ticket.totalAmount
    : calculatedTotalAmount;

  // Format vehicle info nicely
  const vehicleParts = [
    ticket.vehicleYear,
    ticket.vehicleMake,
    ticket.vehicleModel,
    ticket.vehicleType,
  ].filter(Boolean);
  
  const vehicleDesc = vehicleParts.join(' ');
  const hasVehicleInfo = vehicleDesc || ticket.vehiclePlate;

  // Main container style dynamically adjusting based on format
  const containerStyle: React.CSSProperties = {
    fontFamily: isThermal 
      ? (activeFont === 'mono' ? '"JetBrains Mono", "Courier New", Courier, monospace' : '"Inter", "Helvetica Neue", Arial, sans-serif') 
      : '"Inter", "Helvetica Neue", Arial, sans-serif',
    color: '#000000',
    backgroundColor: '#ffffff',
    width: isThermal ? activeWidth : '100%',
    maxWidth: isThermal ? activeWidth : '800px',
    margin: '0 auto',
    padding: isThermal ? (isCompact ? '4px 2px' : '8px 6px') : '24px',
    boxSizing: 'border-box',
    fontSize: isThermal ? (activeWidth === '58mm' ? '10px' : (isCompact ? '11px' : '12px')) : '14px',
    lineHeight: isThermal ? '1.2' : '1.5',
  };

  const headerStyle: React.CSSProperties = {
    textAlign: 'center',
    borderBottom: isThermal ? '1px dashed #000000' : '2px solid #000000',
    paddingBottom: isThermal ? '8px' : '16px',
    marginBottom: isThermal ? '12px' : '24px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: isThermal ? '18px' : '24px',
    fontWeight: 'bold',
    margin: '0 0 4px 0',
    textTransform: 'uppercase',
    letterSpacing: isThermal ? '0px' : '1px',
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: isThermal ? '11px' : '12px',
    margin: '2px 0',
    color: isThermal ? '#000' : '#555555',
  };

  const docTitleStyle: React.CSSProperties = {
    fontSize: isThermal ? '14px' : '18px',
    fontWeight: 'bold',
    marginTop: isThermal ? '8px' : '12px',
    textTransform: 'uppercase',
    letterSpacing: isThermal ? '0px' : '2px',
  };

  const metaSectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isThermal ? 'column' : 'row',
    justifyContent: isThermal ? 'flex-start' : 'space-between',
    gap: isThermal ? '2px' : '0',
    marginBottom: isThermal ? (isCompact ? '6px' : '12px') : '24px',
    borderBottom: isThermal ? '1px dashed #000000' : 'none',
    paddingBottom: isThermal ? (isCompact ? '4px' : '8px') : '0',
    fontSize: isThermal ? (activeWidth === '58mm' ? '10px' : '12px') : '13px',
    lineHeight: isThermal ? '1.2' : '1.6',
  };

  const metaColumnStyle: React.CSSProperties = {
    flex: 1,
  };

  const itemContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: isCompact ? '2px' : '6px',
    marginBottom: isCompact ? '6px' : '12px',
    borderBottom: '1px solid #000000',
    paddingBottom: isCompact ? '4px' : '8px',
  };

  const itemLineStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
  };

  const totalsContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '12px',
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '24px',
    fontSize: '13px',
  };

  const thStyle: React.CSSProperties = {
    borderBottom: '2px solid #000000',
    padding: '8px 4px',
    textAlign: 'left',
    fontWeight: 'bold',
  };

  const thRightStyle: React.CSSProperties = {
    ...thStyle,
    textAlign: 'right',
  };

  const tdStyle: React.CSSProperties = {
    borderBottom: '1px solid #dddddd',
    padding: '8px 4px',
    textAlign: 'left',
  };

  const tdRightStyle: React.CSSProperties = {
    ...tdStyle,
    textAlign: 'right',
  };

  const totalRowStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 'bold',
  };

  const totalTdStyle: React.CSSProperties = {
    padding: '12px 4px 4px 4px',
    borderTop: '2px solid #000000',
    borderBottom: 'none',
  };

  const totalTdRightStyle: React.CSSProperties = {
    ...totalTdStyle,
    textAlign: 'right',
  };

  const legalBoxStyle: React.CSSProperties = {
    backgroundColor: isThermal ? 'transparent' : '#f9f9f9',
    border: isThermal ? 'none' : '1px solid #e0e0e0',
    padding: isThermal ? '0' : '12px',
    fontSize: isThermal ? '10px' : '11px',
    lineHeight: isThermal ? '1.2' : '1.4',
    textAlign: 'justify',
    marginTop: isThermal ? '16px' : '32px',
    marginBottom: isThermal ? '16px' : '24px',
    fontStyle: 'italic',
  };

  const signatureContainerStyle: React.CSSProperties = {
    marginTop: isThermal ? '20px' : '40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: isThermal ? 'center' : 'center',
    justifyContent: isThermal ? 'flex-start' : 'center',
    width: isThermal ? '100%' : '300px',
    marginLeft: isThermal ? '0' : 'auto',
    marginRight: isThermal ? '0' : 'auto',
  };

  const signatureLineStyle: React.CSSProperties = {
    borderBottom: '1px solid #000000',
    width: '100%',
    height: isThermal ? '40px' : '60px',
    marginBottom: isThermal ? '4px' : '6px',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  };

  const signatureLabelStyle: React.CSSProperties = {
    fontSize: isThermal ? '10px' : '11px',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#333333',
    letterSpacing: '1px',
  };

  const footerStyle: React.CSSProperties = {
    textAlign: 'center',
    marginTop: isThermal ? '20px' : '40px',
    paddingTop: isThermal ? '8px' : '16px',
    borderTop: isThermal ? '1px dashed #000000' : '1px solid #eeeeee',
    fontSize: isThermal ? '10px' : '11px',
    color: isThermal ? '#000' : '#888888',
  };

  return (
    <div style={containerStyle} id="printable-buy-ticket-root">
      {/* Company Header */}
      <div style={headerStyle}>
        <h1 style={titleStyle}>{COMPANY_NAME}</h1>
        {COMPANY_PHONE && <p style={subtitleStyle}>Ph: {COMPANY_PHONE}</p>}
        {COMPANY_ADDRESS && <p style={subtitleStyle}>{COMPANY_ADDRESS}</p>}
        {!isThermal && COMPANY_WEBSITE && <p style={{ ...subtitleStyle, color: '#666666' }}>{COMPANY_WEBSITE}</p>}
        <div style={docTitleStyle}>{isThermal ? 'BUY TICKET' : 'Official Buy Ticket'}</div>
      </div>

      {/* Meta Information Section */}
      {isThermal ? (
        <div style={metaSectionStyle}>
          <div style={itemLineStyle}>
            <span>TICKET:</span>
            <span>{ticket.id?.toUpperCase() || '-'}</span>
          </div>
          <div style={itemLineStyle}>
            <span>DATE:</span>
            <span>{ticket.timestamp ? new Date(ticket.timestamp).toLocaleString() : ''}</span>
          </div>
          <div style={itemLineStyle}>
            <span>CUSTOMER:</span>
            <span style={{ fontWeight: 'bold' }}>{customerName}</span>
          </div>
          <div style={itemLineStyle}>
            <span>PAYMENT:</span>
            <span style={{ textTransform: 'uppercase' }}>{ticket.paymentMethod || 'CASH'}</span>
          </div>
          {hasVehicleInfo && (
            <div style={itemLineStyle}>
              <span>VEHICLE:</span>
              <span>{vehicleDesc} {ticket.vehiclePlate ? `[${ticket.vehiclePlate}]` : ''}</span>
            </div>
          )}
          {ticket.notes && (
            <div style={{ marginTop: '4px', fontSize: '10px' }}>
              NOTE: {ticket.notes}
            </div>
          )}
        </div>
      ) : (
        <div style={metaSectionStyle}>
          <div style={metaColumnStyle}>
            <div><strong>Ticket ID:</strong> {ticket.id?.toUpperCase()}</div>
            <div><strong>Date:</strong> {ticket.timestamp ? new Date(ticket.timestamp).toLocaleString() : ''}</div>
            <div><strong>Payment Method:</strong> <span style={{ textTransform: 'capitalize' }}>{ticket.paymentMethod || 'Cash'}</span></div>
          </div>
          <div style={{ ...metaColumnStyle, textAlign: 'right' }}>
            <div><strong>Customer Name:</strong> {customerName}</div>
            {hasVehicleInfo && (
              <div>
                <strong>Vehicle:</strong> {vehicleDesc} {ticket.vehiclePlate ? `[Plate: ${ticket.vehiclePlate}]` : ''}
              </div>
            )}
            {ticket.notes && (
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#555555' }}>
                <strong>Notes:</strong> {ticket.notes}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Itemized Materials List */}
      {isThermal ? (
        <>
          <div style={{ width: '100%', marginBottom: '4px', fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase' }}>Items</div>
          
          {ticketMaterials.map((item, index) => {
            const material = materials.find((m) => m.id === item.materialId);
            const displayNetWeight = item.netWeight - (item.deductionWeight || 0);
            return (
              <div key={index} style={itemContainerStyle}>
                <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
                  {material?.code ? `[${material.code}] ` : ''}{material?.name || 'N/A'}
                </div>
                
                <div style={itemLineStyle}>
                  <span>Gross Wt:</span>
                  <span>{item.netWeight ?? '0'} lb</span>
                </div>
                {(item.deductionWeight || 0) > 0 && (
                  <div style={itemLineStyle}>
                    <span>Deduction:</span>
                    <span>-{item.deductionWeight} lb</span>
                  </div>
                )}
                
                <div style={itemLineStyle}>
                  <span>{displayNetWeight} lb @ ${(item.pricePerUnit || 0).toFixed(2)}/lb</span>
                  <span style={{ fontWeight: 'bold' }}>
                    ${((item.totalAmount !== undefined && item.totalAmount !== null && item.totalAmount > 0) ? item.totalAmount : (displayNetWeight * (item.pricePerUnit || 0))).toFixed(2)}
                  </span>
                </div>
                
                {item.notes && <div style={{ fontSize: '10px', marginTop: '2px' }}>Note: {item.notes}</div>}
              </div>
            );
          })}

          {/* Totals Section */}
          <div style={totalsContainerStyle}>
            <div style={itemLineStyle}>
              <span>TOTAL WEIGHT:</span>
              <span>{totalNetWeight} lb</span>
            </div>
            <div style={{ ...itemLineStyle, fontSize: '16px', fontWeight: 'bold', marginTop: '4px', paddingTop: '4px', borderTop: '2px dashed #000' }}>
              <span>TOTAL PAYOUT:</span>
              <span>${finalTotalAmount.toFixed(2)}</span>
            </div>
          </div>
        </>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}># Item / Material</th>
              <th style={thRightStyle}>Net Weight (lb)</th>
              <th style={thRightStyle}>Deductions (lb)</th>
              <th style={thRightStyle}>Paid Weight (lb)</th>
              <th style={thRightStyle}>Price/lb</th>
              <th style={thRightStyle}>Total Payout</th>
            </tr>
          </thead>
          <tbody>
            {ticketMaterials.map((item, index) => {
              const material = materials.find((m) => m.id === item.materialId);
              const displayNetWeight = (item.netWeight || 0) - (item.deductionWeight || 0);
              const itemTotalAmount = (item.totalAmount !== undefined && item.totalAmount !== null && item.totalAmount > 0) 
                ? item.totalAmount 
                : (displayNetWeight * (item.pricePerUnit || 0));
              return (
                <tr key={index}>
                  <td style={tdStyle}>
                    <div><strong>{material?.code ? `[${material.code}] ` : ''}{material?.name || 'N/A'}</strong></div>
                    {item.notes && <div style={{ fontSize: '10px', color: '#666666', fontStyle: 'italic' }}>Note: {item.notes}</div>}
                  </td>
                  <td style={tdRightStyle}>{item.netWeight ?? '0'}</td>
                  <td style={tdRightStyle}>{item.deductionWeight || '0'}</td>
                  <td style={tdRightStyle}><strong>{displayNetWeight} lb</strong></td>
                  <td style={tdRightStyle}>${(item.pricePerUnit || 0).toFixed(2)}</td>
                  <td style={tdRightStyle}><strong>${itemTotalAmount.toFixed(2)}</strong></td>
                </tr>
              );
            })}

            {/* Totals Section */}
            <tr style={totalRowStyle}>
              <td colSpan={3} style={totalTdStyle}>TOTALS</td>
              <td style={totalTdRightStyle}>{totalNetWeight} lb</td>
              <td style={totalTdStyle}></td>
              <td style={totalTdRightStyle}>${finalTotalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Legal Compliance Statement */}
      <div style={legalBoxStyle}>
        {isThermal 
          ? "I certify I am the sole owner of the material described on this ticket and have the full legal right to sell it."
          : "I, the undersigned, certify that I am the sole owner of the material described on this ticket and have the full legal right to sell it."
        }
      </div>

      {/* Signature Section */}
      <div style={signatureContainerStyle}>
        <div style={signatureLineStyle}>
          {ticket.signatureUrl ? (
            <img 
              src={ticket.signatureUrl} 
              alt="Seller Signature" 
              style={{ maxHeight: isThermal ? (isCompact ? '25px' : '35px') : '55px', maxWidth: isThermal ? '200px' : '280px', objectFit: 'contain' }} 
            />
          ) : (
            <div style={{ height: '1px' }}></div>
          )}
        </div>
        <div style={signatureLabelStyle}>{isThermal ? 'SELLER SIGNATURE' : 'Seller Signature'}</div>
      </div>

      {/* Barcode representation */}
      {shouldShowBarcode && ticket.id && (
        <BarcodeSim value={ticket.id} />
      )}

      {/* Footer */}
      <div style={footerStyle}>
        {isThermal ? (
          <>
            Thank you for your business!<br/>
            {COMPANY_NAME}
          </>
        ) : (
          `Thank you for your business! | ${COMPANY_NAME}`
        )}
      </div>
    </div>
  );
};

export default BuyTicketPrint;
