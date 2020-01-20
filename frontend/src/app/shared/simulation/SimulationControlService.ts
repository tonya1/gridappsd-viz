import { Subject, Observable, Subscription, BehaviorSubject, timer } from 'rxjs';
import { filter, map, pluck, debounce, takeWhile } from 'rxjs/operators';
import * as socketIo from 'socket.io-client';

import { SimulationConfiguration } from './SimulationConfiguration';
import { StompClientService, StompClientConnectionStatus } from '@shared/StompClientService';
import { START_SIMULATION_TOPIC, CONTROL_SIMULATION_TOPIC, SIMULATION_OUTPUT_TOPIC } from './topics';
import { SimulationQueue } from './SimulationQueue';
import { SimulationStatus } from '@commons/SimulationStatus';
import { SimulationSnapshot, DEFAULT_SIMULATION_SNAPSHOT } from '@commons/SimulationSnapshot';
import { SimulationSynchronizationEvents } from '@commons/SimulationSynchronizationEvents';
import { ModelDictionaryMeasurement } from '@shared/topology';
import { SimulationOutputMeasurement, SimulationOutputPayload } from '.';
import { StateStore } from '@shared/state-store';
import { Simulation } from './Simulation';

interface SimulationStartedEventResponse {
  simulationId: string;
  events: Array<{
    allOutputOutage: boolean;
    allInputOutage: boolean;
    inputOutageList: Array<{ objectMRID: string; attribute: string; }>;
    outputOutageList: string[];
    faultMRID: string;
    event_type: string;
    occuredDateTime: number;
    stopDateTime: number;
    PhaseConnectedFaultKind: string;
    phases: string;
  }>;
}

/**
 * This class is responsible for communicating with the platform to process the simulation.
 * Simulation is started when the play button is clicked
 */
export class SimulationControlService {

  private static readonly _INSTANCE_: SimulationControlService = new SimulationControlService();

  private readonly _simulationQueue = SimulationQueue.getInstance();
  private readonly _stateStore = StateStore.getInstance();
  private readonly _stompClientService = StompClientService.getInstance();
  private readonly _currentSimulationStatusNotifer = new BehaviorSubject<SimulationStatus>(SimulationStatus.STOPPED);
  private readonly _socket = socketIo();
  private readonly _simulationSnapshot: SimulationSnapshot = DEFAULT_SIMULATION_SNAPSHOT;
  private readonly _simulationSnapshotReceivedNotifier = new BehaviorSubject<SimulationSnapshot>({} as any);

  private _currentSimulationStatus = SimulationStatus.STOPPED;
  private _didUserStartActiveSimulation = false;
  private _isUserInActiveSimulation = false;
  private _modelDictionaryMeasurementMap: Map<string, ModelDictionaryMeasurement> = null;
  private _outputTimestamp: number;
  private _simulationOutputMeasurementsStream = new Subject<Map<string, SimulationOutputMeasurement>>();
  private _simulationOutputSubscription: Subscription;
  private _currentSimulationId = '';
  private _syncingEnabled = false;

  static getInstance(): SimulationControlService {
    return SimulationControlService._INSTANCE_;
  }

  private constructor() {

    this._onActiveSimulationIdsReceived();
    this._onSimulationStatusChangedUpstream();
    this._onSendFirstSimulationSnapshot();
    this._onSimulationSnapshotReceived();
    this._watchStompClientStatusChanges();
    this._onActiveSimulationSnapshotStateReceived();
    this._onSimulationOutputSnapshotStateReceived();

    this.stopSimulation = this.stopSimulation.bind(this);
    this.pauseSimulation = this.pauseSimulation.bind(this);
    this.resumeSimulation = this.resumeSimulation.bind(this);
    this.requestToJoinActiveSimulation = this.requestToJoinActiveSimulation.bind(this);
    this.isUserInActiveSimulation = this.isUserInActiveSimulation.bind(this);
  }

  private _onActiveSimulationIdsReceived() {
    this._socket.on(SimulationSynchronizationEvents.SIMULATION_ACTIVE_CHANNELS, (activeSimulationIds: string[]) => {
      this._stateStore.update({
        activeSimulationIds: activeSimulationIds.filter(e => e !== this._currentSimulationId)
      });
    });
  }

  private _onSimulationStatusChangedUpstream() {
    this._socket.on(SimulationSynchronizationEvents.SIMULATION_STATUS, (status: SimulationStatus) => {
      this._currentSimulationStatus = status;
      this._currentSimulationStatusNotifer.next(status);
      if (status === SimulationStatus.STOPPED) {
        this._isUserInActiveSimulation = false;
      }
    });
  }

  private _onSendFirstSimulationSnapshot() {
    this._socket.on(SimulationSynchronizationEvents.SIMULATION_SNAPSHOT_INIT, () => {
      this._syncingEnabled = true;
      this._simulationSnapshot.stateStore = this._stateStore.toJson();
      this._simulationSnapshot.activeSimulation = this._simulationQueue.getActiveSimulation();
      this._socket.emit(SimulationSynchronizationEvents.SIMULATION_SNAPSHOT_INIT, this._simulationSnapshot);
    });
  }

  private _onSimulationSnapshotReceived() {
    this._socket.on(SimulationSynchronizationEvents.SIMULATION_SNAPSHOT_RECEIVE, (snapshot: SimulationSnapshot) => {
      this._simulationSnapshotReceivedNotifier.next(snapshot);
    });
  }

  private _watchStompClientStatusChanges() {
    return this._stompClientService.statusChanges()
      .pipe(filter(status => status === StompClientConnectionStatus.CONNECTING))
      .subscribe({
        next: () => {
          if (this._simulationOutputSubscription) {
            this._simulationOutputSubscription.unsubscribe();
            this._simulationOutputSubscription = null;
          }
          if (this._currentSimulationStatus === SimulationStatus.STARTED)
            this.stopSimulation();
        }
      });
  }

  private _onActiveSimulationSnapshotStateReceived() {
    this.selectSimulationSnapshotState('activeSimulation')
      .pipe(filter(value => value !== null))
      .subscribe({
        next: (activeSimulation: Simulation) => this._simulationQueue.push(activeSimulation)
      });
  }

  private _onSimulationOutputSnapshotStateReceived() {
    this.selectSimulationSnapshotState('simulationOutput')
      .pipe(
        filter(value => value !== null),
        debounce(() => timer(0, 16).pipe(takeWhile(() => this._modelDictionaryMeasurementMap === null)))
      )
      .subscribe({
        next: (simulationOutput: SimulationOutputPayload) => this._broadcastSimulationOutputMeasurements(simulationOutput)
      });
  }

  selectSimulationSnapshotState<K extends keyof SimulationSnapshot>(key: K): Observable<SimulationSnapshot[K]> {
    return this._simulationSnapshotReceivedNotifier.asObservable()
      .pipe(
        filter(snapshot => key in snapshot),
        pluck(key)
      );
  }

  requestToJoinActiveSimulation(simulationId: string) {
    this._isUserInActiveSimulation = true;
    this._socket.emit(SimulationSynchronizationEvents.SIMULATION_JOIN, simulationId);
  }

  didUserStartActiveSimulation() {
    return this._didUserStartActiveSimulation;
  }

  isUserInActiveSimulation() {
    return this._isUserInActiveSimulation;
  }

  getOutputTimestamp() {
    return this._outputTimestamp;
  }

  updateModelDictionaryMeasurementMap(newMap: Map<string, ModelDictionaryMeasurement>) {
    this._modelDictionaryMeasurementMap = newMap;
  }

  simulationOutputMeasurementsReceived(): Observable<Map<string, SimulationOutputMeasurement>> {
    return this._simulationOutputMeasurementsStream.asObservable();
  }

  syncSimulationSnapshotState<K extends keyof SimulationSnapshot>(state: Pick<SimulationSnapshot, K>) {
    for (const entry of Object.entries(state)) {
      this._simulationSnapshot[entry[0]] = entry[1];
    }
    if (this._syncingEnabled)
      this._socket.emit(SimulationSynchronizationEvents.SIMULATION_SNAPSHOT_RECEIVE, state);
  }

  statusChanges(): Observable<SimulationStatus> {
    return this._currentSimulationStatusNotifer.asObservable();
  }

  currentStatus() {
    return this._currentSimulationStatus;
  }

  startSimulation() {
    if (this._currentSimulationStatus !== SimulationStatus.STARTED) {
      const activeSimulation = this._simulationQueue.getActiveSimulation();
      const simulationConfig = activeSimulation.config;
      const startTime = new Date(simulationConfig.simulation_config.start_time.replace(/-/g, '/'));
      const startEpoch = startTime.getTime() / 1000.0;
      const config: SimulationConfiguration = {
        ...simulationConfig,
        simulation_config: {
          ...simulationConfig.simulation_config,
          start_time: String(startEpoch)
        }
      };
      activeSimulation.didRun = true;
      this._didUserStartActiveSimulation = true;
      this._isUserInActiveSimulation = true;
      this._currentSimulationStatus = SimulationStatus.STARTED;
      this._currentSimulationStatusNotifer.next(SimulationStatus.STARTED);
      if (!this._simulationOutputSubscription) {
        this._simulationOutputSubscription = this._subscribeToSimulationOutputTopic();
      }
      this._subscribeToStartSimulationTopic();

      // Reset this state
      this.syncSimulationSnapshotState({
        simulationOutput: null
      });

      // Let's wait for all the subscriptions in other components to this topic to complete
      // before sending the message
      setTimeout(() => {
        this._stompClientService.send(
          START_SIMULATION_TOPIC,
          { 'reply-to': START_SIMULATION_TOPIC },
          JSON.stringify(config)
        );
      }, 1000);
    }
  }

  private _subscribeToSimulationOutputTopic() {
    return this._stompClientService.readFrom(SIMULATION_OUTPUT_TOPIC)
      .pipe(
        filter(() => this._currentSimulationStatus === SimulationStatus.STARTED),
        map(JSON.parse as (value: string) => SimulationOutputPayload),
        filter(payload => Boolean(payload))
      )
      .subscribe({
        next: payload => {
          this.syncSimulationSnapshotState({
            simulationOutput: payload
          });
          this._broadcastSimulationOutputMeasurements(payload);
        }
      });
  }

  private _broadcastSimulationOutputMeasurements(payload: SimulationOutputPayload) {
    this._outputTimestamp = payload.message.timestamp;
    const measurements = new Map<string, SimulationOutputMeasurement>();
    for (const [mrid, rawSimulationOutputMeasurement] of Object.entries(payload.message.measurements)) {
      const measurementInModelDictionary = this._modelDictionaryMeasurementMap.get(mrid);
      if (measurementInModelDictionary) {
        const measurement: SimulationOutputMeasurement = {
          name: measurementInModelDictionary.name,
          type: measurementInModelDictionary.measurementType,
          magnitude: rawSimulationOutputMeasurement.magnitude,
          angle: rawSimulationOutputMeasurement.angle,
          value: rawSimulationOutputMeasurement.value,
          mRID: rawSimulationOutputMeasurement.measurement_mrid,
          phases: measurementInModelDictionary.phases,
          conductingEquipmentName: measurementInModelDictionary.ConductingEquipment_name,
          connectivityNode: measurementInModelDictionary.ConnectivityNode,
          conductingEquipmentMRID: measurementInModelDictionary.ConductingEquipment_mRID
        };
        measurements.set(mrid, measurement);
        measurements.set(measurementInModelDictionary.ConductingEquipment_name, measurement);
        measurements.set(measurementInModelDictionary.ConnectivityNode, measurement);
      }
    }
    this._simulationOutputMeasurementsStream.next(measurements);

  }

  private _subscribeToStartSimulationTopic() {
    this._stompClientService.readOnceFrom(START_SIMULATION_TOPIC)
      .pipe(map(JSON.parse as (payload: string) => SimulationStartedEventResponse))
      .subscribe({
        next: payload => {
          this._currentSimulationId = payload.simulationId;
          this._simulationQueue.updateIdOfActiveSimulation(payload.simulationId);
          this._socket.emit(
            SimulationSynchronizationEvents.SIMULATION_STATUS,
            {
              status: SimulationStatus.STARTED,
              simulationId: payload.simulationId
            }
          );
          this._stateStore.update({
            simulationId: payload.simulationId,
            faultMRIDs: payload.events.map(event => event.faultMRID)
          });
        }
      });
  }

  stopSimulation() {
    if (this._didUserStartActiveSimulation) {
      this._currentSimulationStatus = SimulationStatus.STOPPED;
      this._currentSimulationStatusNotifer.next(SimulationStatus.STOPPED);
      this._socket.emit(
        SimulationSynchronizationEvents.SIMULATION_STATUS,
        {
          status: SimulationStatus.STOPPED,
          simulationId: this._currentSimulationId
        }
      );
      this._sendSimulationControlCommand('stop');
      this._didUserStartActiveSimulation = false;
      this._isUserInActiveSimulation = false;
      this._syncingEnabled = false;
    }
  }

  pauseSimulation() {
    this._currentSimulationStatus = SimulationStatus.PAUSED;
    this._currentSimulationStatusNotifer.next(SimulationStatus.PAUSED);
    this._socket.emit(
      SimulationSynchronizationEvents.SIMULATION_STATUS,
      {
        status: this._currentSimulationStatus,
        simulationId: this._currentSimulationId
      }
    );
    this._sendSimulationControlCommand('pause');
  }

  resumeSimulation() {
    this._currentSimulationStatus = SimulationStatus.RESUMED;
    this._currentSimulationStatusNotifer.next(SimulationStatus.RESUMED);
    this._socket.emit(
      SimulationSynchronizationEvents.SIMULATION_STATUS,
      {
        status: this._currentSimulationStatus,
        simulationId: this._currentSimulationId
      }
    );
    this._sendSimulationControlCommand('resume');
  }

  private _sendSimulationControlCommand(command: 'stop' | 'pause' | 'resume') {
    const simulationId = this._simulationQueue.getActiveSimulation().id;
    this._stompClientService.send(`${CONTROL_SIMULATION_TOPIC}.${simulationId}`, {}, `{"command":"${command}"}`);
  }

}
