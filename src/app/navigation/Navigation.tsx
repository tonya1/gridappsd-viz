import * as React from 'react';
import { Link } from 'react-router-dom';

import { Drawer } from './views/drawer/Drawer';
import { ToolBar } from './views/tool-bar/ToolBar';
import { DrawerItem, DrawerItemIcon, DrawerItemLabel } from './views/drawer/DrawerItem';
import { DrawerItemGroup } from './views/drawer/DrawerItemGroup';
import { AppBranding } from './views/app-branding/AppBranding';
import { WebSocketConnectedIndicator } from './views/websocket-connected-indicator/WebSocketConnectedIndicator';
import { SimulationConfiguration, Simulation } from '@shared/simulation';
import { StompClientConnectionStatus } from '@shared/StompClientService';
import { IconButton } from '@shared/buttons';

import './Navigation.light.scss';
import './Navigation.dark.scss';

interface Props {
  previousSimulations: Simulation[];
  websocketStatus: StompClientConnectionStatus;
  version: string;
  onShowSimulationConfigForm: (config: SimulationConfiguration) => void;
  onLogout: () => void;
}

export class Navigation extends React.Component<Props, {}> {

  drawer: Drawer;

  constructor(props: Props) {
    super(props);

    this.openDrawer = this.openDrawer.bind(this);
  }

  render() {
    return (
      <>
        <ToolBar>
          <IconButton
            style='primary'
            className='drawer-opener'
            icon='menu'
            size='large'
            rippleDuration={550}
            noBackground={true}
            onClick={this.drawer ? this.drawer.open : null} />
          <AppBranding version={this.props.version} />
          <div className='right-aligned'>
            <WebSocketConnectedIndicator websocketStatus={this.props.websocketStatus} />
            {
              this.props.children
            }
          </div>
        </ToolBar>
        <Drawer ref={ref => this.drawer = ref}>
          <DrawerItem onClick={() => this.props.onShowSimulationConfigForm(null)}>
            <DrawerItemIcon icon='assignment' />
            <DrawerItemLabel value='Simulations' />
          </DrawerItem>
          {
            this.props.previousSimulations.length > 0
            &&
            <DrawerItemGroup
              header='Previous simulations'
              icon='memory'>
              {
                this.props.previousSimulations.map(simulation => (
                  <DrawerItem
                    key={simulation.name}
                    onClick={() => this.props.onShowSimulationConfigForm(simulation.config)}>
                    <strong>Name:&nbsp;</strong>
                    {simulation.name}
                    &nbsp;&mdash;&nbsp;
                    <strong>ID:&nbsp;</strong>
                    {simulation.id}
                  </DrawerItem>
                ))
              }
            </DrawerItemGroup>
          }
          <DrawerItem>
            <Link to='/applications'>
              <DrawerItemIcon icon='storage' />
              <DrawerItemLabel value='Applications & Services' />
            </Link>
          </DrawerItem>
          <DrawerItem>
            <Link to='/browse'>
              <DrawerItemIcon icon='search' />
              <DrawerItemLabel value='Browse Data' />
            </Link>
          </DrawerItem>
          <DrawerItem>
            <Link to='/stomp-client'>
              <DrawerItemIcon icon='laptop' />
              <DrawerItemLabel value='Stomp Client' />
            </Link>
          </DrawerItem>
          <DrawerItem onClick={this.props.onLogout}>
            <DrawerItemIcon icon='power_settings_new' />
            <DrawerItemLabel value='Log Out' />
          </DrawerItem>
        </Drawer>
      </>
    );
  }

  openDrawer() {
    this.drawer.open();
  }

}
