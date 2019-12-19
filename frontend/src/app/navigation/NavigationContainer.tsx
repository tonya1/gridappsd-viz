import * as React from 'react';
import { Subject, Subscription } from 'rxjs';
import { takeUntil, map } from 'rxjs/operators';

import { Navigation } from './Navigation';
import { Simulation, SimulationQueue, SimulationConfiguration, SimulationControlService } from '@shared/simulation';
import { StompClientConnectionStatus, StompClientService } from '@shared/StompClientService';
import { ConfigurationManager } from '@shared/ConfigurationManager';
import { StateStore } from '@shared/state-store';

interface Props {
  onShowSimulationConfigForm: (config: SimulationConfiguration) => void;
  onLogout: () => void;
  onJoinActiveSimulation: (simulationId: string) => void;
}

interface State {
  previousSimulations: Simulation[];
  version: string;
  stompClientConnectionStatus: StompClientConnectionStatus;
  activeSimulationIds: string[];
}

export class NavigationContainer extends React.Component<Props, State> {

  readonly simulationControlService = SimulationControlService.getInstance();

  private readonly _stateStore = StateStore.getInstance();
  private readonly _simulationQueue = SimulationQueue.getInstance();
  private readonly _stompClientService = StompClientService.getInstance();
  private readonly _configurationManager = ConfigurationManager.getInstance();
  private readonly _unsubscriber = new Subject<void>();

  constructor(props: Props) {
    super(props);

    this.state = {
      previousSimulations: this._simulationQueue.getAllSimulations(),
      stompClientConnectionStatus: this._stompClientService.isActive() ? StompClientConnectionStatus.CONNECTED : StompClientConnectionStatus.CONNECTING,
      version: '',
      activeSimulationIds: []
    };

  }

  componentDidMount() {
    this._subscribeToActiveSimulationIdsStateStoreChange();
    this._subscribeToAllSimulationsQueueSteam();
    this._subscribeToStompClientStatusChanges();
    this._subscribeToConfigurationChanges();
  }

  private _subscribeToActiveSimulationIdsStateStoreChange() {
    return this._stateStore.select('activeSimulationIds')
      .pipe(takeUntil(this._unsubscriber))
      .subscribe({
        next: activeSimulationIds => this.setState({ activeSimulationIds })
      });
  }

  private _subscribeToAllSimulationsQueueSteam(): Subscription {
    return this._simulationQueue.queueChanges()
      .pipe(
        takeUntil(this._unsubscriber),
        map(simulations => simulations.filter(simulation => simulation.didRun))
      )
      .subscribe({
        next: simulations => this.setState({ previousSimulations: simulations })
      });
  }

  private _subscribeToStompClientStatusChanges() {
    this._stompClientService.statusChanges()
      .pipe(takeUntil(this._unsubscriber))
      .subscribe({
        next: state => this.setState({ stompClientConnectionStatus: state })
      });
  }

  private _subscribeToConfigurationChanges() {
    this._configurationManager.configurationChanges('version')
      .pipe(takeUntil(this._unsubscriber))
      .subscribe({
        next: version => this.setState({ version })
      });
  }

  componentWillUnmount() {
    this._unsubscriber.next();
    this._unsubscriber.complete();
  }

  render() {
    return (
      <Navigation
        version={this.state.version}
        stompClientConnectionStatus={this.state.stompClientConnectionStatus}
        previousSimulations={this.state.previousSimulations}
        activeSimulationIds={this.state.activeSimulationIds}
        onShowSimulationConfigForm={this.props.onShowSimulationConfigForm}
        onLogout={this.props.onLogout}
        onJoinActiveSimulation={this.props.onJoinActiveSimulation}>
        {this.props.children}
      </Navigation>
    );
  }

}