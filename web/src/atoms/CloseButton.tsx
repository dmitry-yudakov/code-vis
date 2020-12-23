import { FC, SyntheticEvent } from 'react';
import IconButton from '@material-ui/core/IconButton';
import CloseIcon from '@material-ui/icons/CloseOutlined';

export const CloseButton: FC<{ onClick: (e: SyntheticEvent) => void }> = ({
  onClick,
}) => (
  <IconButton onClick={onClick}>
    <CloseIcon />
  </IconButton>
);
