import { ConductingEquipmentType, MeasurementType } from '@shared/topology/model-dictionary';

export interface SimulationOutputMeasurement {
  mRID: string;
  name: string;
  type: MeasurementType;
  magnitude: number;
  angle: number;
  value: number;
  conductingEquipmentName: string;
  conductingEquipmentType: ConductingEquipmentType;
  connectivityNode: string;
  conductingEquipmentMRID: string;
  phases: string;
}
