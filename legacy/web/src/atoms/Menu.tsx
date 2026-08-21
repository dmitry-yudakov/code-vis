import React from 'react';
import { Popover, Button, ButtonGroup } from '@mui/material';

const Menu: React.FC<{
  options: Array<[string, () => void]>;
  positionAnchor: HTMLElement | null;
  onClose: () => void;
}> = ({ options, positionAnchor, onClose }) => {
  return (
    <Popover
      anchorEl={positionAnchor}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'center',
      }}
      transformOrigin={{
        vertical: 'bottom',
        horizontal: 'center',
      }}
      open={!!positionAnchor}
      onClose={onClose}
    >
      <ButtonGroup>
        {options.map(([name, action]) => (
          <Button key={name} onClick={() => action()}>
            {name}
          </Button>
        ))}
      </ButtonGroup>
    </Popover>
  );
};

export default Menu;
