import { SALES_SIDE_STATES, SALES_STAGES, SALES_STATUS } from '../../domain/salesStatus';

/** <option>s for every sales status, grouped into pipeline stages and side states. */
export function SalesStatusOptions() {
  return (
    <>
      <optgroup label="Satış Aşamaları">
        {SALES_STAGES.map((s) => (
          <option key={s} value={s}>
            {SALES_STATUS[s].label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Diğer Durumlar">
        {SALES_SIDE_STATES.map((s) => (
          <option key={s} value={s}>
            {SALES_STATUS[s].label}
          </option>
        ))}
      </optgroup>
    </>
  );
}
